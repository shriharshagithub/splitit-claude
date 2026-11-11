-- Reusable group invite links, and an email when an existing user is added to a group.

-- 1. A group can have one open "link" invite. Unlike phone/email invites it is not used up when
--    someone joins with it, so it can be shared with several people.
alter table public.group_invites drop constraint group_invites_contact_kind_check;
alter table public.group_invites add constraint group_invites_contact_kind_check
  check (contact_kind in ('phone', 'email', 'link'));

create or replace function public._claim_invites(u uuid, invite_token text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0; p public.profiles;
begin
  select * into p from public.profiles where id = u;
  for r in
    select * from public.group_invites i
    where i.accepted_at is null
      and (i.contact = p.email or i.contact = p.phone or (invite_token is not null and i.token = invite_token))
    for update
  loop
    if public._join_group(r.group_id, u, r.invited_by) then n := n + 1; end if;
    if r.contact_kind <> 'link' then
      update public.group_invites set accepted_by = u, accepted_at = now() where id = r.id;
    end if;
  end loop;
  return n;
end $$;

-- Any member can get (or create) the group's invite link token.
create function public.group_invite_link(g uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare u uuid := public._uid(); tok text;
begin
  if not public.is_member(g) then perform public._fail('You are not a member of this group.'); end if;
  select token into tok from public.group_invites where group_id = g and contact_kind = 'link' and accepted_at is null;
  if tok is null then
    insert into public.group_invites (group_id, contact, contact_kind, invited_by)
      values (g, 'link:' || g::text, 'link', u)
      on conflict (group_id, contact) where accepted_at is null do nothing
      returning token into tok;
    if tok is null then
      select token into tok from public.group_invites where group_id = g and contact_kind = 'link' and accepted_at is null;
    end if;
  end if;
  return tok;
end $$;

-- The admin can cancel the current link (the next request makes a new one).
create function public.reset_group_invite_link(g uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._uid();
  if not public.is_admin(g) then perform public._fail('Only the group admin can reset the invite link.'); end if;
  delete from public.group_invites where group_id = g and contact_kind = 'link';
end $$;

revoke execute on function public.group_invite_link(uuid), public.reset_group_invite_link(uuid) from public, anon;
grant execute on function public.group_invite_link(uuid), public.reset_group_invite_link(uuid) to authenticated;

-- 2. Email existing users when they are added to a group (as well as the in-app notification).
create or replace function public._on_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.type in ('payment_request', 'payment_marked', 'payment_confirmed', 'payment_declined', 'reminder', 'confirm_nudge', 'member_added') then
    perform public._call_function('notify-email', jsonb_build_object('notification_id', new.id));
  end if;
  return null;
end $$;
