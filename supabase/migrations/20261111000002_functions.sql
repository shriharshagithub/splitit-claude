-- Every write goes through these functions. Each one checks the caller and validates input
-- on the server. Errors use SQLSTATE P0001 with a message that is safe to show to users.

create function public._fail(msg text) returns void language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = msg;
end $$;

create function public._uid() returns uuid language plpgsql stable as $$
declare u uuid := auth.uid();
begin
  if u is null then perform public._fail('Please log in again.'); end if;
  return u;
end $$;

create function public._first_name(u uuid) returns text language sql stable security definer set search_path = '' as $$
  select split_part(btrim(full_name), ' ', 1) from public.profiles where id = u;
$$;

create function public._inr(p bigint) returns text language sql immutable as $$
  -- ₹1,23,456.78 (Indian grouping)
  select '₹' || case
    when p / 100 < 1000 then (p / 100)::text
    else regexp_replace(((p / 100) / 1000)::text, '(\d)(?=(\d\d)+$)', '\1,', 'g') || ',' || lpad(((p / 100) % 1000)::text, 3, '0')
  end || '.' || lpad((p % 100)::text, 2, '0');
$$;

-- Normalise a phone number or email typed by a user.
create function public.normalize_contact(c text, out kind text, out value text) language plpgsql immutable as $$
declare d text;
begin
  c := btrim(coalesce(c, ''));
  if position('@' in c) > 0 then
    kind := 'email'; value := lower(c);
    if value !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then kind := null; value := null; end if;
    return;
  end if;
  d := regexp_replace(c, '[^0-9]', '', 'g');
  if length(d) = 12 and left(d, 2) = '91' then d := substr(d, 3); end if;
  if length(d) = 11 and left(d, 1) = '0' then d := substr(d, 2); end if;
  if d ~ '^[6-9][0-9]{9}$' then kind := 'phone'; value := '+91' || d; else kind := null; value := null; end if;
end $$;

create function public._notify(u uuid, g uuid, t public.notification_type, ttl text, bdy text, pl jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, group_id, type, title, body, payload) values (u, g, t, ttl, bdy, pl);
$$;

create function public._log(g uuid, actor uuid, k text, s text, amt bigint default null, pl jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into public.activity (group_id, actor_id, kind, summary, amount, payload) values (g, actor, k, s, amt, pl);
$$;

-- ---------------------------------------------------------------------------
-- Balances
-- ---------------------------------------------------------------------------
-- Net per member: paid - owed + completed settlements sent - completed settlements received.
-- Positive = is owed money. Internal: no membership check.
create function public._group_nets(g uuid) returns table (user_id uuid, net bigint)
language sql stable security definer set search_path = '' as $$
  select m.user_id,
    coalesce((select sum(e.total_amount) from public.expenses e where e.group_id = g and e.paid_by = m.user_id), 0)
    - coalesce((select sum(s.amount_owed) from public.expense_splits s join public.expenses e on e.id = s.expense_id
                where e.group_id = g and s.user_id = m.user_id), 0)
    + coalesce((select sum(t.amount) from public.settlements t where t.group_id = g and t.status = 'completed' and t.from_user = m.user_id), 0)
    - coalesce((select sum(t.amount) from public.settlements t where t.group_id = g and t.status = 'completed' and t.to_user = m.user_id), 0)
  from public.group_members m where m.group_id = g;
$$;

create function public.group_nets(g uuid) returns table (user_id uuid, net bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_member(g) then perform public._fail('You are not a member of this group.'); end if;
  return query select * from public._group_nets(g);
end $$;

create function public._refresh_debt_since(g uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.debt_since d using public._group_nets(g) n
    where d.group_id = g and d.user_id = n.user_id and n.net >= 0;
  delete from public.debt_since d where d.group_id = g
    and not exists (select 1 from public.group_members m where m.group_id = g and m.user_id = d.user_id);
  insert into public.debt_since (group_id, user_id)
    select g, n.user_id from public._group_nets(g) n where n.net < 0
    on conflict do nothing;
end $$;

-- Home screen: one row per group with the caller's net position.
create function public.my_groups() returns table (
  id uuid, name text, type public.group_type, member_count int, my_net bigint, my_role public.member_role, created_at timestamptz
) language sql stable security definer set search_path = '' as $$
  select g.id, g.name, g.type,
    (select count(*)::int from public.group_members x where x.group_id = g.id),
    coalesce((select n.net from public._group_nets(g.id) n where n.user_id = auth.uid()), 0),
    m.role, g.created_at
  from public.groups g join public.group_members m on m.group_id = g.id and m.user_id = auth.uid()
  order by g.created_at desc;
$$;

-- Expense feed page with the caller's share, newest first. Keyset pagination.
create function public.group_expenses(g uuid, before_date date default null, before_created timestamptz default null, page_size int default 30)
returns table (
  id uuid, description text, category text, total_amount bigint, expense_date date, paid_by uuid, payer_name text,
  split_type public.split_type, created_by uuid, created_at timestamptz, updated_at timestamptz, my_owed bigint, has_receipt boolean
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_member(g) then perform public._fail('You are not a member of this group.'); end if;
  return query
    select e.id, e.description, e.category, e.total_amount, e.expense_date, e.paid_by, p.full_name, e.split_type,
      e.created_by, e.created_at, e.updated_at,
      coalesce((select s.amount_owed from public.expense_splits s where s.expense_id = e.id and s.user_id = auth.uid()), 0),
      e.receipt_url is not null
    from public.expenses e join public.profiles p on p.id = e.paid_by
    where e.group_id = g
      and (before_date is null or (e.expense_date, e.created_at) < (before_date, before_created))
    order by e.expense_date desc, e.created_at desc
    limit least(greatest(page_size, 1), 100);
end $$;

-- ---------------------------------------------------------------------------
-- Profiles, sign-up and invites
-- ---------------------------------------------------------------------------
create function public._join_group(g uuid, u uuid, by_user uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare gname text;
begin
  insert into public.group_members (group_id, user_id, role) values (g, u, 'member') on conflict do nothing;
  if not found then return false; end if;
  select name into gname from public.groups where id = g;
  perform public._notify(u, g, 'member_added', 'Added to ' || gname,
    coalesce(public._first_name(by_user), 'Someone') || ' added you to ' || gname || '.', jsonb_build_object('by', by_user));
  perform public._log(g, by_user, 'member_added',
    coalesce(public._first_name(by_user), 'Someone') || ' added ' || public._first_name(u) || ' to ' || gname, null,
    jsonb_build_object('user_id', u));
  return true;
end $$;

create function public._claim_invites(u uuid, invite_token text default null) returns int
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
    update public.group_invites set accepted_by = u, accepted_at = now() where id = r.id;
  end loop;
  return n;
end $$;

-- Creates the profile row for every new auth user and joins any groups they were invited to.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare ph text; nm text;
begin
  ph := case when new.phone is null or new.phone = '' then null
             when left(new.phone, 1) = '+' then new.phone else '+' || new.phone end;
  nm := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
                 split_part(coalesce(new.email, 'Friend'), '@', 1));
  insert into public.profiles (id, full_name, phone, email)
  values (new.id, left(nm, 80), ph, lower(new.email));
  perform public._claim_invites(new.id, new.raw_user_meta_data ->> 'invite_token');
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- A logged-in user opening an invite link.
create function public.accept_invite(invite_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u uuid := public._uid(); g uuid;
begin
  select group_id into g from public.group_invites where token = invite_token;
  if g is null then perform public._fail('This invite link is not valid.'); end if;
  perform public._claim_invites(u, invite_token);
  return g;
end $$;

-- Public, minimal invite preview for the sign-up screen (group name and inviter first name only).
create function public.invite_preview(invite_token text) returns table (group_name text, invited_by text, accepted boolean)
language sql stable security definer set search_path = '' as $$
  select g.name, public._first_name(i.invited_by), i.accepted_at is not null
  from public.group_invites i join public.groups g on g.id = i.group_id where i.token = invite_token;
$$;
grant execute on function public.invite_preview(text) to anon;

-- Google users have no phone at first; let them add one once so friends can find them.
create function public.set_my_phone(p_phone text) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public._uid(); c record;
begin
  select * into c from public.normalize_contact(p_phone);
  if c.kind is distinct from 'phone' then perform public._fail('Enter a 10-digit Indian mobile number.'); end if;
  if exists (select 1 from public.profiles where phone = c.value and id <> u) then
    perform public._fail('That phone number is already on another SplitIt account.');
  end if;
  update public.profiles set phone = c.value where id = u and phone is null;
  if not found then perform public._fail('Your phone number is already set.'); end if;
  perform public._claim_invites(u);
end $$;

-- ---------------------------------------------------------------------------
-- Groups and members
-- ---------------------------------------------------------------------------
-- Adds an existing user, or records an invite. Returns {status, name?, token?, contact}.
create function public._add_contact(g uuid, raw text, by_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c record; target uuid; tok text; gname text;
begin
  select * into c from public.normalize_contact(raw);
  if c.kind is null then
    perform public._fail('"' || left(raw, 40) || '" is not a valid phone number or email.');
  end if;
  select id into target from public.profiles where (c.kind = 'email' and email = c.value) or (c.kind = 'phone' and phone = c.value);
  if target is not null then
    if public._join_group(g, target, by_user) then
      return jsonb_build_object('status', 'added', 'contact', c.value, 'name', (select full_name from public.profiles where id = target));
    end if;
    return jsonb_build_object('status', 'already_member', 'contact', c.value);
  end if;
  insert into public.group_invites (group_id, contact, contact_kind, invited_by)
    values (g, c.value, c.kind, by_user)
    on conflict (group_id, contact) where accepted_at is null do update set invited_by = excluded.invited_by
    returning token into tok;
  select name into gname from public.groups where id = g;
  perform public._log(g, by_user, 'member_invited', public._first_name(by_user) || ' invited ' || c.value || ' to ' || gname);
  return jsonb_build_object('status', 'invited', 'contact', c.value, 'kind', c.kind, 'token', tok);
end $$;

create function public.create_group(p_name text, p_type public.group_type, p_contacts text[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := public._uid(); g uuid; c text; results jsonb := '[]';
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 60 then perform public._fail('Give the group a name of up to 60 characters.'); end if;
  if coalesce(cardinality(p_contacts), 0) > 50 then perform public._fail('Add up to 50 people at a time.'); end if;
  insert into public.groups (name, type, created_by) values (btrim(p_name), p_type, u) returning id into g;
  insert into public.group_members (group_id, user_id, role) values (g, u, 'admin');
  perform public._log(g, u, 'group_created', public._first_name(u) || ' created ' || btrim(p_name));
  foreach c in array coalesce(p_contacts, '{}') loop
    results := results || public._add_contact(g, c, u);
  end loop;
  return jsonb_build_object('group_id', g, 'members', results);
end $$;

create function public.add_group_member(g uuid, contact text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := public._uid();
begin
  if not public.is_admin(g) then perform public._fail('Only the group admin can add members.'); end if;
  return public._add_contact(g, contact, u);
end $$;

create function public.cancel_invite(invite_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare g uuid;
begin
  perform public._uid();
  select group_id into g from public.group_invites where id = invite_id and accepted_at is null;
  if g is null or not public.is_admin(g) then perform public._fail('Only the group admin can cancel invites.'); end if;
  delete from public.group_invites where id = invite_id;
end $$;

create function public.remove_group_member(g uuid, member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public._uid(); bal bigint;
begin
  if not public.is_admin(g) then perform public._fail('Only the group admin can remove members.'); end if;
  if member = u then perform public._fail('You are the admin. Delete the group instead of leaving it.'); end if;
  select net into bal from public._group_nets(g) where user_id = member;
  if bal is null then perform public._fail('That person is not in this group.'); end if;
  if bal <> 0 then
    perform public._fail(public._first_name(member) || ' still has a balance of ' || public._inr(abs(bal)) || '. Settle up before removing them.');
  end if;
  if exists (select 1 from public.settlements where group_id = g and status in ('pending', 'marked_paid') and member in (from_user, to_user)) then
    perform public._fail(public._first_name(member) || ' has a payment waiting for confirmation.');
  end if;
  delete from public.group_members where group_id = g and user_id = member;
  perform public._log(g, u, 'member_removed', public._first_name(u) || ' removed ' || public._first_name(member));
end $$;

create function public.update_group(g uuid, p_name text, p_type public.group_type) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public._uid();
begin
  if not public.is_admin(g) then perform public._fail('Only the group admin can edit the group.'); end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 60 then perform public._fail('Give the group a name of up to 60 characters.'); end if;
  update public.groups set name = btrim(p_name), type = p_type where id = g;
end $$;

create function public.delete_group(g uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._uid();
  if not public.is_admin(g) then perform public._fail('Only the group admin can delete the group.'); end if;
  delete from public.groups where id = g;
end $$;

-- ---------------------------------------------------------------------------
-- Expenses
-- ---------------------------------------------------------------------------
-- Mirror of src/core/splits.ts computeSplits. inputs: [{"user_id": uuid, "value": int}]
create function public.compute_splits(p_total bigint, p_type public.split_type, p_inputs jsonb, p_payer uuid)
returns table (user_id uuid, amount bigint) language plpgsql as $$
declare n int; s bigint; bad int; rem bigint;
begin
  if p_total is null or p_total <= 0 then perform public._fail('Enter an amount greater than ₹0.00.'); end if;
  if jsonb_typeof(p_inputs) <> 'array' or jsonb_array_length(p_inputs) = 0 then perform public._fail('Choose at least one person to split with.'); end if;

  create temp table if not exists _si (uid uuid, val bigint, amt bigint) on commit drop;
  truncate _si;
  insert into _si (uid, val)
    select (x ->> 'user_id')::uuid,
      case when p_type = 'equal' then 0
           when jsonb_typeof(x -> 'value') = 'number' and (x ->> 'value') ~ '^[0-9]+$' then (x ->> 'value')::bigint
           else -1 end
    from jsonb_array_elements(p_inputs) x;
  select count(*), count(distinct uid), sum(val), count(*) filter (where val < 0) into n, rem, s, bad from _si;
  if rem <> n then perform public._fail('A person appears twice in the split.'); end if;
  if bad > 0 then perform public._fail('Each person needs a whole-number value.'); end if;

  if p_type = 'equal' then
    update _si set amt = p_total / n;
  elsif p_type = 'exact' then
    if s <> p_total then perform public._fail('Splits add up to ' || public._inr(s) || ' but the total is ' || public._inr(p_total) || '.'); end if;
    update _si set amt = val;
  elsif p_type = 'percentage' then
    if s <> 10000 then perform public._fail('Percentages must add up to 100%.'); end if;
    update _si set amt = (p_total * val) / 10000;
  else
    if s <= 0 then perform public._fail('Give at least one person a share.'); end if;
    update _si set amt = (p_total * val) / s;
  end if;

  select p_total - sum(amt) into rem from _si;
  if rem <> 0 then
    if exists (select 1 from _si where uid = p_payer) then update _si set amt = amt + rem where uid = p_payer;
    else insert into _si (uid, val, amt) values (p_payer, 0, rem); end if;
  end if;
  return query select uid, amt from _si where amt > 0;
end $$;

-- Create or update an expense. The client may supply the id (offline queue), so replays are safe.
-- p: {id?, group_id, paid_by, total_amount, description, category, expense_date, split_type, inputs,
--     receipt_path?, receipt_items?: [{name, amount, user_ids}], base_updated_at?}
-- Last write wins; {conflict: true} tells the client another edit was overwritten.
create function public.save_expense(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := public._uid();
  eid uuid := coalesce((p ->> 'id')::uuid, gen_random_uuid());
  g uuid := (p ->> 'group_id')::uuid;
  payer uuid := (p ->> 'paid_by')::uuid;
  total bigint;
  st public.split_type := (p ->> 'split_type')::public.split_type;
  ex public.expenses;
  conflict boolean := false;
  is_new boolean;
  d date := coalesce((p ->> 'expense_date')::date, current_date);
  gname text;
  r record;
begin
  if g is null or not public.is_member(g) then perform public._fail('You are not a member of this group.'); end if;
  if (p ->> 'total_amount') !~ '^[0-9]+$' then perform public._fail('Enter a valid amount.'); end if;
  total := (p ->> 'total_amount')::bigint;
  if not exists (select 1 from public.group_members where group_id = g and user_id = payer) then
    perform public._fail('The person who paid must be in this group.');
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p -> 'inputs', '[]')) x
    where not exists (select 1 from public.group_members m where m.group_id = g and m.user_id = (x ->> 'user_id')::uuid)
  ) then perform public._fail('Everyone in the split must be in this group.'); end if;
  if d > current_date + 1 or d < date '2000-01-01' then perform public._fail('Choose a date that is not in the future.'); end if;

  select * into ex from public.expenses where id = eid for update;
  is_new := ex.id is null;
  if not is_new then
    if ex.group_id <> g then perform public._fail('This expense belongs to another group.'); end if;
    if ex.created_by <> u and not public.is_admin(g) then perform public._fail('Only the person who added this expense or the group admin can change it.'); end if;
    conflict := (p ? 'base_updated_at') and ex.updated_at > (p ->> 'base_updated_at')::timestamptz;
    update public.expenses set paid_by = payer, total_amount = total, description = btrim(p ->> 'description'),
      category = coalesce(p ->> 'category', 'general'), expense_date = d, split_type = st,
      split_inputs = coalesce(p -> 'inputs', '[]'), updated_at = now()
      where id = eid;
    delete from public.expense_splits where expense_id = eid;
    delete from public.receipt_items where expense_id = eid;
  else
    insert into public.expenses (id, group_id, paid_by, total_amount, description, category, expense_date, split_type, split_inputs, receipt_url, created_by)
    values (eid, g, payer, total, btrim(coalesce(p ->> 'description', '')), coalesce(p ->> 'category', 'general'), d, st,
            coalesce(p -> 'inputs', '[]'),
            case when (p ->> 'receipt_path') like g::text || '/%' then p ->> 'receipt_path' end, u);
  end if;

  insert into public.expense_splits (expense_id, user_id, amount_owed)
    select eid, c.user_id, c.amount from public.compute_splits(total, st, coalesce(p -> 'inputs', '[]'), payer) c;

  if jsonb_typeof(p -> 'receipt_items') = 'array' then
    insert into public.receipt_items (expense_id, item_name, item_amount, assigned_user_ids)
      select eid, left(btrim(x ->> 'name'), 120), (x ->> 'amount')::bigint,
        array(select jsonb_array_elements_text(x -> 'user_ids')::uuid)
      from jsonb_array_elements(p -> 'receipt_items') x;
    if exists (select 1 from public.receipt_items ri, unnest(ri.assigned_user_ids) a
               where ri.expense_id = eid and not exists (select 1 from public.group_members m where m.group_id = g and m.user_id = a)) then
      perform public._fail('Bill items can only be assigned to group members.');
    end if;
  end if;

  if is_new then
    select name into gname from public.groups where id = g;
    perform public._log(g, u, 'expense_added',
      public._first_name(u) || ' added ' || btrim(p ->> 'description'), total, jsonb_build_object('expense_id', eid));
    for r in select user_id from public.group_members where group_id = g and user_id <> u loop
      perform public._notify(r.user_id, g, 'expense_added', 'New expense in ' || gname,
        public._first_name(u) || ' added ' || btrim(p ->> 'description') || ' (' || public._inr(total) || ').',
        jsonb_build_object('expense_id', eid));
    end loop;
  else
    perform public._log(g, u, 'expense_edited', public._first_name(u) || ' edited ' || btrim(p ->> 'description'), total,
      jsonb_build_object('expense_id', eid));
  end if;
  perform public._refresh_debt_since(g);
  select * into ex from public.expenses where id = eid;
  return jsonb_build_object('id', eid, 'updated_at', ex.updated_at, 'conflict', conflict, 'created', is_new);
end $$;

-- A split must always add up to its expense. Checked at commit so multi-row writes can finish first.
create function public._assert_split_sum(eid uuid) returns void language plpgsql as $$
declare t bigint; s bigint;
begin
  select total_amount into t from public.expenses where id = eid;
  if t is null then return; end if;
  select coalesce(sum(amount_owed), 0) into s from public.expense_splits where expense_id = eid;
  if s <> t then raise exception 'expense % splits sum to % but total is %', eid, s, t; end if;
end $$;

create function public._check_split_sum() returns trigger language plpgsql as $$
begin
  perform public._assert_split_sum(coalesce(new.expense_id, old.expense_id));
  return null;
end $$;

create function public._check_expense_sum() returns trigger language plpgsql as $$
begin
  perform public._assert_split_sum(new.id);
  return null;
end $$;

create constraint trigger expense_splits_sum after insert or update or delete on public.expense_splits
  deferrable initially deferred for each row execute function public._check_split_sum();
create constraint trigger expense_total_sum after insert or update of total_amount on public.expenses
  deferrable initially deferred for each row execute function public._check_expense_sum();
