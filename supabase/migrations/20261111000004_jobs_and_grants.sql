-- Email hooks, the daily reminder job, and function permissions.
-- Needs two Vault secrets (see README): project_url and hook_secret.
create extension if not exists pg_net;
create extension if not exists pg_cron;

create function public._call_function(fn text, body jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare base text; secret text;
begin
  select decrypted_secret into base from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'hook_secret';
  if base is null or secret is null then return; end if;
  perform net.http_post(
    url := base || '/functions/v1/' || fn,
    body := body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', secret),
    timeout_milliseconds := 8000);
end $$;

create function public._on_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.type in ('payment_request', 'payment_marked', 'payment_confirmed', 'payment_declined', 'reminder', 'confirm_nudge') then
    perform public._call_function('notify-email', jsonb_build_object('notification_id', new.id));
  end if;
  return null;
end $$;
create trigger notifications_email after insert on public.notifications
  for each row execute function public._on_notification();

create function public._on_invite() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.contact_kind = 'email' then
    perform public._call_function('notify-email', jsonb_build_object('invite_id', new.id));
  end if;
  return null;
end $$;
create trigger invites_email after insert on public.group_invites
  for each row execute function public._on_invite();

-- 09:00 IST every day.
select cron.schedule('splitit-daily-reminders', '30 3 * * *', $$select public._call_function('reminders', '{}'::jsonb)$$);

-- Permissions: nothing is callable by default; grant the public API explicitly.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.is_member(uuid), public.is_admin(uuid), public.shares_group_with(uuid),
  public.group_nets(uuid), public.my_groups(), public.group_expenses(uuid, date, timestamptz, int),
  public.accept_invite(text), public.set_my_phone(text),
  public.create_group(text, public.group_type, text[]), public.add_group_member(uuid, text), public.cancel_invite(uuid),
  public.remove_group_member(uuid, uuid), public.update_group(uuid, text, public.group_type), public.delete_group(uuid),
  public.save_expense(jsonb), public.delete_expense(uuid),
  public.request_payment(uuid, uuid, bigint), public.start_settlement(uuid, uuid, bigint, public.settlement_method),
  public.mark_settlement_paid(uuid, text), public.respond_settlement(uuid, boolean),
  public.normalize_contact(text)
to authenticated;
grant execute on function public.invite_preview(text) to anon, authenticated;
-- Used inside RLS policies and called by granted functions running as definer.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
