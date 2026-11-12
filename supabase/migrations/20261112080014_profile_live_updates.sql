-- When someone changes their profile (name, photo, UPI ID), tell every group they are in,
-- so open screens (e.g. Settle up waiting for a UPI ID) refresh by themselves.
create function public.broadcast_profile_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare gid uuid;
begin
  if (new.full_name, new.upi_id, new.avatar_url, new.phone) is not distinct from (old.full_name, old.upi_id, old.avatar_url, old.phone) then
    return null;
  end if;
  for gid in select group_id from public.group_members where user_id = new.id loop
    perform realtime.send(jsonb_build_object('table', 'profiles', 'op', 'UPDATE'), 'change', 'group:' || gid, true);
  end loop;
  return null;
end $$;
create trigger rt_profiles after update on public.profiles for each row execute function public.broadcast_profile_change();
revoke execute on function public.broadcast_profile_change() from public, anon, authenticated;
