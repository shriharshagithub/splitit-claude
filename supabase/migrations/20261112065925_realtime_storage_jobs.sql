-- Live updates, file storage, email hooks and the daily reminder job.

-- Live updates: a private broadcast per group ("group:<id>") and per person ("user:<id>").
-- Only a small "something changed" message is sent; screens then re-read through the normal security rules.
create function public.safe_uuid(t text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin return t::uuid; exception when others then return null; end $$;

create function public.can_listen(topic text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when topic like 'group:%' then public.is_member(public.safe_uuid(substr(topic, 7)))
    when topic like 'user:%' then substr(topic, 6) = auth.uid()::text
    else false end;
$$;
grant execute on function public.can_listen(text), public.safe_uuid(text) to authenticated;

create policy "members receive their group's live updates" on realtime.messages
  for select to authenticated using (public.can_listen(realtime.topic()));

create function public.broadcast_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r record := coalesce(new, old);
  gid uuid;
  topic text;
begin
  if tg_table_name = 'groups' then gid := r.id;
  elsif tg_table_name = 'notifications' then
    perform realtime.send(jsonb_build_object('table', tg_table_name, 'op', tg_op), 'change', 'user:' || r.user_id, true);
    return null;
  else gid := r.group_id;
  end if;
  perform realtime.send(jsonb_build_object('table', tg_table_name, 'op', tg_op), 'change', 'group:' || gid, true);
  -- a member being added or removed also needs to refresh that person's home screen
  if tg_table_name = 'group_members' then
    perform realtime.send(jsonb_build_object('table', tg_table_name, 'op', tg_op), 'change', 'user:' || r.user_id, true);
  end if;
  return null;
end $$;

create trigger rt_expenses after insert or update or delete on public.expenses for each row execute function public.broadcast_change();
create trigger rt_settlements after insert or update or delete on public.settlements for each row execute function public.broadcast_change();
create trigger rt_members after insert or update or delete on public.group_members for each row execute function public.broadcast_change();
create trigger rt_groups after update or delete on public.groups for each row execute function public.broadcast_change();
create trigger rt_notifications after insert or update on public.notifications for each row execute function public.broadcast_change();
create trigger rt_invites after insert or update or delete on public.invites for each row execute function public.broadcast_change();

-- Storage: private bill photos (per group), public avatars (per person).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bills', 'bills', false, 10485760, array['image/jpeg', 'image/png']),
       ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "members upload bills" on storage.objects for insert to authenticated
  with check (bucket_id = 'bills' and public.is_member(public.safe_uuid((storage.foldername(name))[1])));
create policy "members read bills" on storage.objects for select to authenticated
  using (bucket_id = 'bills' and public.is_member(public.safe_uuid((storage.foldername(name))[1])));
create policy "own avatar read" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own avatar upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own avatar update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own avatar delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Server-to-server calls (database -> edge functions) carry a shared secret kept in Vault.
-- The secret is created once per project (see README); edge functions check it with this function.
create function public.check_hook_secret(p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets s where s.name = 'hook_secret' and s.decrypted_secret = p);
$$;
revoke execute on function public.check_hook_secret(text) from public, anon, authenticated;
grant execute on function public.check_hook_secret(text) to service_role;

create function public.call_edge(fn text, body jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  base text := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url');
  secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'hook_secret');
begin
  if base is null or secret is null then
    raise warning 'SplitIt: vault secrets project_url / hook_secret are missing; % not called', fn;
    return;
  end if;
  perform net.http_post(
    url := base || '/functions/v1/' || fn,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', secret),
    body := body,
    timeout_milliseconds := 10000);
end $$;
revoke execute on function public.call_edge(text, jsonb) from public, anon, authenticated;

-- Every notification is also emailed (send-email decides the wording).
create function public.email_on_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.call_edge('send-email', jsonb_build_object('kind', 'notification', 'id', new.id));
  return null;
end $$;
create trigger email_notification after insert on public.notifications for each row execute function public.email_on_notification();

create function public.email_on_invite() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is not null then
    perform public.call_edge('send-email', jsonb_build_object('kind', 'invite', 'id', new.id));
  end if;
  return null;
end $$;
create trigger email_invite after insert on public.invites for each row execute function public.email_on_invite();

-- Daily reminders at 09:00 IST (03:30 UTC).
select cron.schedule('splitit-daily-reminders', '30 3 * * *', $$ select public.call_edge('reminders', '{}'::jsonb) $$);

-- Data the reminders job needs (service role only).
create function public.reminder_candidates() returns table (group_id uuid, group_name text, user_id uuid, net bigint, oldest_debt timestamptz)
language sql stable security definer set search_path = '' as $$
  select g.id, g.name, n.user_id, n.net,
    (select min(e.created_at) from public.expenses e join public.expense_splits s on s.expense_id = e.id
      where e.group_id = g.id and s.user_id = n.user_id and s.amount_owed > 0 and e.paid_by <> n.user_id)
  from public.groups g cross join lateral public.group_nets(g.id) n
  where exists (select 1 from public.group_nets(g.id) x where x.net <> 0);
$$;
revoke execute on function public.reminder_candidates() from public, anon, authenticated;
grant execute on function public.reminder_candidates() to service_role;

-- Logged-out visitors can only preview an invite link.
revoke execute on all functions in schema public from anon;
grant execute on function public.invite_preview(text), public.inr(bigint) to anon;
