-- Every write the app makes goes through one of these functions. Each one checks the caller.

-- New auth user -> profile, then claim any invites sent to their phone or email.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  ph text := nullif(coalesce(new.raw_user_meta_data->>'phone', new.phone, ''), '');
  inv record;
begin
  if ph is not null and ph !~ '^91[6-9][0-9]{9}$' then ph := null; end if;
  insert into public.profiles (id, full_name, phone, email, avatar_url)
  values (new.id,
          left(coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), nullif(new.raw_user_meta_data->>'name', ''), split_part(coalesce(new.email, ''), '@', 1)), 80),
          ph, lower(new.email), new.raw_user_meta_data->>'avatar_url');
  perform public.claim_invites_for(new.id);
  return new;
end $$;

create function public.claim_invites_for(uid uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
  inv record;
  n integer := 0;
begin
  select * into p from public.profiles where id = uid;
  for inv in
    select * from public.invites
    where accepted_at is null
      and ((p.phone is not null and phone = p.phone) or (p.email is not null and lower(email) = lower(p.email)))
    for update
  loop
    insert into public.group_members (group_id, user_id, role) values (inv.group_id, uid, 'member')
    on conflict do nothing;
    if found then
      insert into public.activity (group_id, actor, kind, summary)
      values (inv.group_id, uid, 'member_joined', p.full_name || ' joined from an invite');
      n := n + 1;
    end if;
    update public.invites set accepted_at = now(), accepted_by = uid where id = inv.id;
  end loop;
  return n;
end $$;
revoke execute on function public.claim_invites_for(uuid) from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profile email in step with auth (e.g. Google sign-in).
create function public.handle_user_email_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = lower(new.email) where id = new.id;
  perform public.claim_invites_for(new.id);
  return new;
end $$;
create trigger on_auth_user_email after update of email on auth.users
  for each row when (old.email is distinct from new.email) execute function public.handle_user_email_change();

create function public.claim_my_invites() returns integer
language sql security definer set search_path = '' as $$ select public.claim_invites_for(auth.uid()); $$;

-- Small helpers -------------------------------------------------------------
create function public.require_user() returns uuid
language plpgsql stable set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Please log in again.' using errcode = '28000'; end if;
  return auth.uid();
end $$;

create function public.require_member(gid uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_user();
  if not public.is_member(gid) then raise exception 'You are not in this group.' using errcode = '42501'; end if;
end $$;

create function public.display_name(uid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(full_name, ''), 'Someone') from public.profiles where id = uid;
$$;

create function public.inr(p bigint) returns text
language sql immutable set search_path = '' as $$
  select '₹' || to_char(p / 100, 'FM99,99,99,99,990') || '.' || lpad((p % 100)::text, 2, '0');
$$;

create function public.notify_user(uid uuid, gid uuid, kind text, t text, b text, extra jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, group_id, type, title, body, payload) values (uid, gid, kind, t, b, extra);
$$;
revoke execute on function public.notify_user(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;

-- Profile ----------------------------------------------------------------------
create function public.update_profile(p_full_name text, p_phone text, p_upi_id text, p_reminder_freq text, p_avatar_url text default null)
returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.require_user();
  r public.profiles;
  ph text := nullif(btrim(coalesce(p_phone, '')), '');
  upi text := nullif(lower(btrim(coalesce(p_upi_id, ''))), '');
begin
  if char_length(btrim(coalesce(p_full_name, ''))) = 0 then raise exception 'Please enter your name.' using errcode = '22023'; end if;
  if ph is not null and ph !~ '^91[6-9][0-9]{9}$' then raise exception 'Enter a 10-digit Indian mobile number.' using errcode = '22023'; end if;
  if upi is not null and upi !~ '^[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9]{1,63}$' then
    raise exception 'That UPI ID does not look right. It should look like name@bank.' using errcode = '22023';
  end if;
  if ph is not null and exists (select 1 from public.profiles where phone = ph and id <> uid) then
    raise exception 'That mobile number is already on another account.' using errcode = '23505';
  end if;
  update public.profiles set
    full_name = left(btrim(p_full_name), 80), phone = ph, upi_id = upi,
    reminder_freq = coalesce(p_reminder_freq, reminder_freq),
    avatar_url = coalesce(p_avatar_url, avatar_url)
  where id = uid returning * into r;
  perform public.claim_invites_for(uid);
  return r;
end $$;

-- Groups --------------------------------------------------------------------------
create function public.create_group(p_name text, p_type text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.require_user();
  gid uuid;
begin
  if char_length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'Give the group a name.' using errcode = '22023'; end if;
  insert into public.groups (name, type, created_by) values (btrim(p_name), coalesce(p_type, 'other'), uid) returning id into gid;
  insert into public.group_members (group_id, user_id, role) values (gid, uid, 'admin');
  insert into public.activity (group_id, actor, kind, summary) values (gid, uid, 'group_created', public.display_name(uid) || ' created the group');
  return gid;
end $$;

create function public.update_group(p_group uuid, p_name text, p_type text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_member(p_group);
  if not public.is_admin(p_group) then raise exception 'Only the group admin can edit the group.' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'Give the group a name.' using errcode = '22023'; end if;
  update public.groups set name = btrim(p_name), type = p_type, updated_at = now() where id = p_group;
end $$;

create function public.delete_group(p_group uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_member(p_group);
  if not public.is_admin(p_group) then raise exception 'Only the group admin can delete the group.' using errcode = '42501'; end if;
  delete from public.groups where id = p_group;
end $$;

-- Add a member by phone or email. Existing users join straight away (and get an email);
-- anyone else gets an invite that adds them when they sign up.
create function public.add_member(p_group uuid, p_contact text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.require_user();
  c text := btrim(coalesce(p_contact, ''));
  digits text := regexp_replace(c, '\D', '', 'g');
  ph text;
  em text;
  target uuid;
  inv public.invites;
  gname text;
begin
  perform public.require_member(p_group);
  if not public.is_admin(p_group) then raise exception 'Only the group admin can add people.' using errcode = '42501'; end if;
  if position('@' in c) > 0 then
    em := lower(c);
    if em !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then raise exception 'That email address does not look right.' using errcode = '22023'; end if;
    select id into target from public.profiles where lower(email) = em;
  else
    if length(digits) = 10 then ph := '91' || digits;
    elsif length(digits) = 11 and left(digits, 1) = '0' then ph := '91' || right(digits, 10);
    elsif length(digits) = 12 and left(digits, 2) = '91' then ph := digits;
    end if;
    if ph is null or ph !~ '^91[6-9][0-9]{9}$' then raise exception 'Enter a 10-digit Indian mobile number or an email address.' using errcode = '22023'; end if;
    select id into target from public.profiles where phone = ph;
  end if;
  select name into gname from public.groups where id = p_group;

  if target is not null then
    if exists (select 1 from public.group_members where group_id = p_group and user_id = target) then
      return jsonb_build_object('status', 'already_member', 'user_id', target, 'name', public.display_name(target));
    end if;
    insert into public.group_members (group_id, user_id, role) values (p_group, target, 'member');
    insert into public.activity (group_id, actor, kind, summary)
    values (p_group, uid, 'member_added', public.display_name(uid) || ' added ' || public.display_name(target));
    perform public.notify_user(target, p_group, 'member_added', 'You were added to ' || gname,
      public.display_name(uid) || ' added you to "' || gname || '" on SplitIt.', jsonb_build_object('group_id', p_group));
    return jsonb_build_object('status', 'added', 'user_id', target, 'name', public.display_name(target));
  end if;

  select * into inv from public.invites
  where group_id = p_group and accepted_at is null and (phone = ph or lower(email) = em) limit 1;
  if inv.id is null then
    insert into public.invites (group_id, invited_by, phone, email) values (p_group, uid, ph, em) returning * into inv;
    insert into public.activity (group_id, actor, kind, summary)
    values (p_group, uid, 'member_invited', public.display_name(uid) || ' invited ' || coalesce(em, '+' || ph));
  end if;
  return jsonb_build_object('status', 'invited', 'invite_id', inv.id, 'token', inv.token,
    'kind', case when em is null then 'phone' else 'email' end, 'contact', coalesce(em, ph));
end $$;

create function public.cancel_invite(p_invite uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare gid uuid;
begin
  select group_id into gid from public.invites where id = p_invite and accepted_at is null;
  if gid is null or not public.is_admin(gid) then raise exception 'Invite not found.' using errcode = '42501'; end if;
  delete from public.invites where id = p_invite;
end $$;

create function public.remove_member(p_group uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.require_user();
  net bigint;
begin
  perform public.require_member(p_group);
  if p_user <> uid and not public.is_admin(p_group) then raise exception 'Only the group admin can remove people.' using errcode = '42501'; end if;
  select coalesce(n.net, 0) into net from public.group_nets(p_group) n where n.user_id = p_user;
  if coalesce(net, 0) <> 0 then raise exception 'Settle up with this person before removing them.' using errcode = '22023'; end if;
  if (select role from public.group_members where group_id = p_group and user_id = p_user) = 'admin'
     and (select count(*) from public.group_members where group_id = p_group and role = 'admin') = 1
     and (select count(*) from public.group_members where group_id = p_group) > 1 then
    raise exception 'Make someone else admin before leaving.' using errcode = '22023';
  end if;
  delete from public.group_members where group_id = p_group and user_id = p_user;
  insert into public.activity (group_id, actor, kind, summary)
  values (p_group, uid, 'member_removed', case when p_user = uid then public.display_name(uid) || ' left the group'
          else public.display_name(uid) || ' removed ' || public.display_name(p_user) end);
end $$;

-- Group invite link: admins can see and reset it; anyone logged in can join with it.
create function public.group_invite_code(p_group uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare code text;
begin
  perform public.require_member(p_group);
  select invite_code into code from public.groups where id = p_group;
  return code;
end $$;

create function public.reset_invite_code(p_group uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare code text;
begin
  perform public.require_member(p_group);
  if not public.is_admin(p_group) then raise exception 'Only the group admin can reset the invite link.' using errcode = '42501'; end if;
  update public.groups set invite_code = encode(extensions.gen_random_bytes(9), 'hex') where id = p_group returning invite_code into code;
  return code;
end $$;

-- What an invite link points to (safe for logged-out visitors: just the group name and size).
create function public.invite_preview(p_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('group_id', g.id, 'name', g.name, 'type', g.type,
    'members', (select count(*) from public.group_members m where m.group_id = g.id),
    'invited_by', public.display_name(g.created_by))
  from public.groups g
  where g.invite_code = p_code
     or g.id = (select group_id from public.invites where token = p_code and accepted_at is null);
$$;

create function public.join_group(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.require_user();
  gid uuid;
begin
  select id into gid from public.groups where invite_code = p_code;
  if gid is null then
    select group_id into gid from public.invites where token = p_code and accepted_at is null;
    if gid is not null then update public.invites set accepted_at = now(), accepted_by = uid where token = p_code; end if;
  end if;
  if gid is null then raise exception 'This invite link has expired or was reset. Ask for a new one.' using errcode = 'P0002'; end if;
  insert into public.group_members (group_id, user_id, role) values (gid, uid, 'member') on conflict do nothing;
  if found then
    insert into public.activity (group_id, actor, kind, summary) values (gid, uid, 'member_joined', public.display_name(uid) || ' joined with the invite link');
  end if;
  return gid;
end $$;

-- Splits: same rules as src/core/splits.ts ------------------------------------------
create function public.compute_splits(p_total bigint, p_payer uuid, p_type text, p_members uuid[], p_values jsonb)
returns table (user_id uuid, amount bigint)
language plpgsql immutable set search_path = '' as $$
declare
  mem uuid[];
  w bigint[] := '{}';
  wsum bigint := 0;
  assigned bigint := 0;
  s bigint;
  shares bigint[] := '{}';
  i int;
  v numeric;
  recv int;
begin
  -- de-duplicate, keeping first-seen order
  mem := array(select m from unnest(p_members) with ordinality as t(m, o) group by m order by min(o));
  if p_total is null or p_total <= 0 then raise exception 'Enter an amount above ₹0.' using errcode = '22023'; end if;
  if coalesce(array_length(mem, 1), 0) = 0 then raise exception 'Pick at least one person to split with.' using errcode = '22023'; end if;
  for i in 1 .. array_length(mem, 1) loop
    if p_type = 'equal' then v := 1;
    else
      v := coalesce((p_values ->> mem[i]::text)::numeric, 0);
      if v < 0 or v <> trunc(v) then raise exception 'Split values must be whole numbers, zero or more.' using errcode = '22023'; end if;
    end if;
    w := w || v::bigint;
    wsum := wsum + v::bigint;
  end loop;
  if p_type = 'exact' then
    if wsum <> p_total then raise exception 'The amounts add up to %, not %.', public.inr(wsum), public.inr(p_total) using errcode = '22023'; end if;
    return query select mem[k], w[k] from generate_subscripts(mem, 1) k;
    return;
  elsif p_type = 'percentage' then
    if wsum <> 10000 then raise exception 'Percentages must add up to 100%%.' using errcode = '22023'; end if;
  elsif p_type = 'shares' then
    if wsum <= 0 then raise exception 'Give at least one share.' using errcode = '22023'; end if;
  elsif p_type <> 'equal' then
    raise exception 'Unknown split type.' using errcode = '22023';
  end if;
  for i in 1 .. array_length(mem, 1) loop
    s := (p_total * w[i]) / wsum;  -- bigint division floors for non-negative values
    shares := shares || s;
    assigned := assigned + s;
  end loop;
  recv := coalesce(array_position(mem, p_payer), 1);
  shares[recv] := shares[recv] + (p_total - assigned);
  return query select mem[k], shares[k] from generate_subscripts(mem, 1) k;
end $$;

-- Create or edit an expense. The id comes from the phone so an offline retry can never duplicate it.
-- Last write wins; the result says whether someone else's newer edit was overwritten.
create function public.save_expense(
  p_id uuid, p_group uuid, p_paid_by uuid, p_total bigint, p_description text, p_category text, p_date date,
  p_split_type text, p_members uuid[], p_values jsonb, p_items jsonb default null, p_receipt_url text default null,
  p_base_updated_at timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.require_user();
  old public.expenses;
  conflict boolean := false;
  bad uuid;
  gname text;
  m uuid;
  it jsonb;
begin
  perform public.require_member(p_group);
  if p_id is null then p_id := gen_random_uuid(); end if;
  select * into old from public.expenses where id = p_id for update;
  if old.id is not null then
    if old.group_id <> p_group then raise exception 'Expense not found.' using errcode = '42501'; end if;
    if old.created_by <> uid and not public.is_admin(p_group) then
      raise exception 'Only the person who added this expense or the group admin can change it.' using errcode = '42501';
    end if;
    conflict := p_base_updated_at is not null and old.updated_at > p_base_updated_at;
  end if;
  if not exists (select 1 from public.group_members where group_id = p_group and user_id = p_paid_by) then
    raise exception 'The payer must be in the group.' using errcode = '22023';
  end if;
  select x into bad from unnest(p_members) x
    where not exists (select 1 from public.group_members where group_id = p_group and user_id = x) limit 1;
  if bad is not null then raise exception 'Everyone in the split must be in the group.' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_description, ''))) = 0 then raise exception 'Add a short description.' using errcode = '22023'; end if;
  if p_date is null or p_date > (now() at time zone 'Asia/Kolkata')::date + 1 then raise exception 'Pick a date that is not in the future.' using errcode = '22023'; end if;

  if old.id is null then
    insert into public.expenses (id, group_id, paid_by, total_amount, description, category, expense_date, split_type, split_values, receipt_url, created_by)
    values (p_id, p_group, p_paid_by, p_total, btrim(p_description), coalesce(nullif(p_category, ''), 'general'), p_date, p_split_type,
            coalesce(p_values, '{}'::jsonb), p_receipt_url, uid);
  else
    update public.expenses set paid_by = p_paid_by, total_amount = p_total, description = btrim(p_description),
      category = coalesce(nullif(p_category, ''), 'general'), expense_date = p_date, split_type = p_split_type,
      split_values = coalesce(p_values, '{}'::jsonb), receipt_url = coalesce(p_receipt_url, receipt_url), updated_at = now()
    where id = p_id;
    delete from public.expense_splits where expense_id = p_id;
    delete from public.receipt_items where expense_id = p_id;
  end if;
  insert into public.expense_splits (expense_id, user_id, amount_owed)
  select p_id, c.user_id, c.amount from public.compute_splits(p_total, p_paid_by, p_split_type, p_members, p_values) c;
  if p_items is not null then
    for it in select * from jsonb_array_elements(p_items) loop
      insert into public.receipt_items (expense_id, item_name, item_amount, assigned_user_ids)
      values (p_id, left(coalesce(it->>'name', 'Item'), 80), (it->>'amount')::bigint,
              array(select jsonb_array_elements_text(it->'assignees')::uuid));
    end loop;
  end if;
  select name into gname from public.groups where id = p_group;
  insert into public.activity (group_id, actor, kind, summary)
  values (p_group, uid, case when old.id is null then 'expense_added' else 'expense_edited' end,
          public.display_name(uid) || case when old.id is null then ' added "' else ' edited "' end || btrim(p_description) || '" (' || public.inr(p_total) || ')');
  return jsonb_build_object('id', p_id, 'conflict', conflict, 'created', old.id is null);
end $$;

create function public.delete_expense(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.require_user();
  e public.expenses;
begin
  select * into e from public.expenses where id = p_id;
  if e.id is null then return; end if;  -- already gone (e.g. an offline delete replayed)
  perform public.require_member(e.group_id);
  if e.created_by <> uid and not public.is_admin(e.group_id) then
    raise exception 'Only the person who added this expense or the group admin can delete it.' using errcode = '42501';
  end if;
  delete from public.expenses where id = p_id;
  insert into public.activity (group_id, actor, kind, summary)
  values (e.group_id, uid, 'expense_deleted', public.display_name(uid) || ' deleted "' || e.description || '" (' || public.inr(e.total_amount) || ')');
end $$;

-- Balances ------------------------------------------------------------------------
-- Net per member: paid - owed + confirmed settlements paid - confirmed settlements received.
-- Positive = is owed money.
create function public.group_nets(p_group uuid) returns table (user_id uuid, net bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.is_member(p_group) then
    raise exception 'You are not in this group.' using errcode = '42501';
  end if;
  return query
  with ids as (
    select m.user_id from public.group_members m where m.group_id = p_group
    union select e.paid_by from public.expenses e where e.group_id = p_group
    union select s.user_id from public.expense_splits s join public.expenses e on e.id = s.expense_id where e.group_id = p_group
  ), parts as (
    select e.paid_by as uid, e.total_amount as v from public.expenses e where e.group_id = p_group
    union all select s.user_id, -s.amount_owed from public.expense_splits s join public.expenses e on e.id = s.expense_id where e.group_id = p_group
    union all select t.from_user, t.amount from public.settlements t where t.group_id = p_group and t.status = 'completed'
    union all select t.to_user, -t.amount from public.settlements t where t.group_id = p_group and t.status = 'completed'
  )
  select ids.user_id, coalesce(sum(parts.v), 0)::bigint from ids left join parts on parts.uid = ids.user_id group by ids.user_id;
end $$;

-- One row per group I'm in: my net position, member count, last activity.
create function public.my_groups() returns table (id uuid, name text, type text, member_count int, my_net bigint, is_admin boolean, last_activity timestamptz)
language sql stable security definer set search_path = '' as $$
  select g.id, g.name, g.type,
    (select count(*)::int from public.group_members m where m.group_id = g.id),
    coalesce((select n.net from public.group_nets(g.id) n where n.user_id = auth.uid()), 0),
    gm.role = 'admin',
    greatest(g.updated_at, (select max(a.created_at) from public.activity a where a.group_id = g.id))
  from public.groups g join public.group_members gm on gm.group_id = g.id and gm.user_id = auth.uid()
  order by 7 desc nulls last;
$$;

-- Settlements -------------------------------------------------------------------
create function public.request_payment(p_group uuid, p_from uuid, p_amount bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.require_user();
  gname text;
begin
  perform public.require_member(p_group);
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be above ₹0.' using errcode = '22023'; end if;
  if p_from = uid or not exists (select 1 from public.group_members where group_id = p_group and user_id = p_from) then
    raise exception 'That person is not in this group.' using errcode = '22023';
  end if;
  select name into gname from public.groups where id = p_group;
  perform public.notify_user(p_from, p_group, 'payment_request',
    public.display_name(uid) || ' is asking for ' || public.inr(p_amount),
    public.display_name(uid) || ' is asking for ' || public.inr(p_amount) || ' for ' || gname || '.',
    jsonb_build_object('group_id', p_group, 'to_user', uid, 'amount', p_amount));
  insert into public.activity (group_id, actor, kind, summary)
  values (p_group, uid, 'payment_requested', public.display_name(uid) || ' asked ' || public.display_name(p_from) || ' for ' || public.inr(p_amount));
end $$;

-- The payer starts a settlement (pending). Re-uses an open one for the same people and method.
create function public.start_settlement(p_group uuid, p_to uuid, p_amount bigint, p_method text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.require_user();
  sid uuid;
begin
  perform public.require_member(p_group);
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be above ₹0.' using errcode = '22023'; end if;
  if p_method not in ('upi', 'cash') then raise exception 'Pick UPI or cash.' using errcode = '22023'; end if;
  if p_to = uid or not exists (select 1 from public.group_members where group_id = p_group and user_id = p_to) then
    raise exception 'That person is not in this group.' using errcode = '22023';
  end if;
  select id into sid from public.settlements
  where group_id = p_group and from_user = uid and to_user = p_to and status = 'pending' order by created_at desc limit 1 for update;
  if sid is not null then
    update public.settlements set amount = p_amount, method = p_method where id = sid;
  else
    insert into public.settlements (group_id, from_user, to_user, amount, method) values (p_group, uid, p_to, p_amount, p_method) returning id into sid;
  end if;
  return sid;
end $$;

create function public.mark_settlement_paid(p_id uuid, p_upi_ref text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.require_user();
  s public.settlements;
  gname text;
  ref text := nullif(btrim(coalesce(p_upi_ref, '')), '');
begin
  select * into s from public.settlements where id = p_id for update;
  if s.id is null or not public.is_member(s.group_id) then raise exception 'Payment not found.' using errcode = '42501'; end if;
  if s.from_user <> uid then raise exception 'Only the person paying can mark this as paid.' using errcode = '42501'; end if;
  if s.status <> 'pending' then raise exception 'This payment is already %.', replace(s.status, '_', ' ') using errcode = '22023'; end if;
  update public.settlements set status = 'marked_paid', marked_paid_at = now(), upi_ref = left(ref, 40) where id = p_id;
  select name into gname from public.groups where id = s.group_id;
  perform public.notify_user(s.to_user, s.group_id, 'payment_marked',
    public.display_name(uid) || ' says they paid you ' || public.inr(s.amount),
    public.display_name(uid) || ' says they paid you ' || public.inr(s.amount) || case when s.method = 'cash' then ' in cash' else ' via UPI' end
      || ' for ' || gname || '.' || coalesce(' Ref: ' || ref || '.', '') || ' Please confirm.',
    jsonb_build_object('group_id', s.group_id, 'settlement_id', s.id, 'amount', s.amount, 'method', s.method, 'upi_ref', ref));
  insert into public.activity (group_id, actor, kind, summary)
  values (s.group_id, uid, 'payment_marked', public.display_name(uid) || ' marked ' || public.inr(s.amount) || ' to ' || public.display_name(s.to_user)
          || ' as paid' || case when s.method = 'cash' then ' in cash' else ' via UPI' end);
end $$;

create function public.respond_settlement(p_id uuid, p_confirm boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.require_user();
  s public.settlements;
  gname text;
begin
  select * into s from public.settlements where id = p_id for update;
  if s.id is null or not public.is_member(s.group_id) then raise exception 'Payment not found.' using errcode = '42501'; end if;
  if s.to_user <> uid then raise exception 'Only the person receiving the money can confirm or decline it.' using errcode = '42501'; end if;
  if s.status <> 'marked_paid' then raise exception 'This payment is not waiting for you (it is %).', replace(s.status, '_', ' ') using errcode = '22023'; end if;
  select name into gname from public.groups where id = s.group_id;
  if p_confirm then
    update public.settlements set status = 'completed', completed_at = now() where id = p_id;
    perform public.notify_user(s.from_user, s.group_id, 'payment_confirmed',
      public.display_name(uid) || ' confirmed your ' || public.inr(s.amount),
      public.display_name(uid) || ' confirmed receiving ' || public.inr(s.amount) || ' for ' || gname || '. That debt is cleared.',
      jsonb_build_object('group_id', s.group_id, 'settlement_id', s.id, 'amount', s.amount));
  else
    update public.settlements set status = 'declined', declined_at = now() where id = p_id;
    perform public.notify_user(s.from_user, s.group_id, 'payment_declined',
      public.display_name(uid) || ' has not received your ' || public.inr(s.amount),
      public.display_name(uid) || ' says they have not received ' || public.inr(s.amount) || ' for ' || gname || '. The debt is still open; you can try again.',
      jsonb_build_object('group_id', s.group_id, 'settlement_id', s.id, 'amount', s.amount));
  end if;
  -- the matching "please confirm" notification is answered
  update public.notifications set read_at = coalesce(read_at, now())
  where user_id = uid and type in ('payment_marked', 'confirm_nudge') and payload->>'settlement_id' = p_id::text;
  insert into public.activity (group_id, actor, kind, summary)
  values (s.group_id, uid, case when p_confirm then 'payment_confirmed' else 'payment_declined' end,
          public.display_name(uid) || case when p_confirm then ' confirmed ' else ' declined ' end || public.inr(s.amount) || ' from ' || public.display_name(s.from_user));
end $$;

create function public.mark_notifications_read(p_ids uuid[] default null) returns void
language sql security definer set search_path = '' as $$
  update public.notifications set read_at = now()
  where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids));
$$;

-- Lock down: only these functions are callable by logged-in users.
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.is_member(uuid), public.is_admin(uuid), public.shares_group_with(uuid),
  public.claim_my_invites(), public.update_profile(text, text, text, text, text), public.create_group(text, text),
  public.update_group(uuid, text, text), public.delete_group(uuid), public.add_member(uuid, text), public.cancel_invite(uuid),
  public.remove_member(uuid, uuid), public.group_invite_code(uuid), public.reset_invite_code(uuid), public.join_group(text),
  public.compute_splits(bigint, uuid, text, uuid[], jsonb), public.save_expense(uuid, uuid, uuid, bigint, text, text, date, text, uuid[], jsonb, jsonb, text, timestamptz),
  public.delete_expense(uuid), public.group_nets(uuid), public.my_groups(), public.request_payment(uuid, uuid, bigint),
  public.start_settlement(uuid, uuid, bigint, text), public.mark_settlement_paid(uuid, text), public.respond_settlement(uuid, boolean),
  public.mark_notifications_read(uuid[]), public.require_user(), public.require_member(uuid), public.display_name(uuid), public.inr(bigint)
to authenticated;
grant execute on function public.invite_preview(text), public.inr(bigint) to anon;
