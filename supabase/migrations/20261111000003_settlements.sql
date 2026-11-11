-- Expense delete, payment requests and the peer-to-peer settlement state machine:
-- pending -> marked_paid -> completed | declined. Only completed settlements change balances.

create function public.delete_expense(eid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public._uid(); ex public.expenses;
begin
  select * into ex from public.expenses where id = eid;
  if ex.id is null or not public.is_member(ex.group_id) then perform public._fail('This expense no longer exists.'); end if;
  if ex.created_by <> u and not public.is_admin(ex.group_id) then
    perform public._fail('Only the person who added this expense or the group admin can delete it.');
  end if;
  delete from public.expenses where id = eid;
  perform public._log(ex.group_id, u, 'expense_deleted', public._first_name(u) || ' deleted ' || ex.description, ex.total_amount);
  perform public._refresh_debt_since(ex.group_id);
end $$;

create function public._net_of(g uuid, who uuid) returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce((select net from public._group_nets(g) where user_id = who), 0);
$$;

-- Creditor asks a debtor to pay.
create function public.request_payment(g uuid, debtor uuid, p_amount bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public._uid(); gname text; mine bigint; theirs bigint;
begin
  if not public.is_member(g) then perform public._fail('You are not a member of this group.'); end if;
  if debtor = u or not exists (select 1 from public.group_members where group_id = g and user_id = debtor) then
    perform public._fail('That person is not in this group.');
  end if;
  mine := public._net_of(g, u); theirs := public._net_of(g, debtor);
  if p_amount is null or p_amount <= 0 or mine <= 0 or theirs >= 0 or p_amount > least(mine, -theirs) then
    perform public._fail('That amount is more than ' || public._first_name(debtor) || ' owes you.');
  end if;
  if exists (select 1 from public.notifications where user_id = debtor and group_id = g and type = 'payment_request'
             and payload ->> 'creditor' = u::text and created_at > now() - interval '1 hour') then
    perform public._fail('You asked ' || public._first_name(debtor) || ' less than an hour ago.');
  end if;
  select name into gname from public.groups where id = g;
  perform public._notify(debtor, g, 'payment_request', 'Payment request',
    public._first_name(u) || ' is asking for ' || public._inr(p_amount) || ' for ' || gname || '.',
    jsonb_build_object('creditor', u, 'amount', p_amount));
  perform public._log(g, u, 'payment_requested',
    public._first_name(u) || ' asked ' || public._first_name(debtor) || ' for ' || public._inr(p_amount), p_amount,
    jsonb_build_object('debtor', debtor));
end $$;

-- Debtor starts paying. Re-uses an open pending settlement for the same pair so retries do not pile up.
create function public.start_settlement(g uuid, p_to uuid, p_amount bigint, p_method public.settlement_method)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := public._uid(); mine bigint; sid uuid; cred public.profiles;
begin
  if not public.is_member(g) then perform public._fail('You are not a member of this group.'); end if;
  if p_to = u or not exists (select 1 from public.group_members where group_id = g and user_id = p_to) then
    perform public._fail('That person is not in this group.');
  end if;
  mine := public._net_of(g, u);
  if p_amount is null or p_amount <= 0 or mine >= 0 or p_amount > -mine then
    perform public._fail('That is more than you owe in this group.');
  end if;
  select * into cred from public.profiles where id = p_to;
  if p_method = 'upi' and cred.upi_id is null then
    perform public._fail('Ask ' || public._first_name(p_to) || ' to add a UPI ID, or settle in cash.');
  end if;
  if exists (select 1 from public.settlements where group_id = g and from_user = u and to_user = p_to and status = 'marked_paid') then
    perform public._fail('You already marked a payment to ' || public._first_name(p_to) || ' as paid. Wait for them to confirm it.');
  end if;
  select id into sid from public.settlements
    where group_id = g and from_user = u and settlements.to_user = p_to and status = 'pending' for update;
  if sid is null then
    insert into public.settlements (group_id, from_user, to_user, amount, method)
      values (g, u, p_to, p_amount, p_method) returning id into sid;
  else
    update public.settlements set amount = p_amount, method = p_method, created_at = now() where id = sid;
  end if;
  return jsonb_build_object('id', sid, 'upi_id', cred.upi_id, 'name', cred.full_name);
end $$;

-- Only the payer can claim the payment went through.
create function public.mark_settlement_paid(sid uuid, ref text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public._uid(); s public.settlements; gname text; r text := nullif(btrim(coalesce(ref, '')), '');
begin
  select * into s from public.settlements where id = sid for update;
  if s.id is null or s.from_user <> u then perform public._fail('Only the person paying can mark this as paid.'); end if;
  if s.status <> 'pending' then perform public._fail('This payment is no longer waiting to be marked as paid.'); end if;
  if r is not null and r !~ '^[0-9A-Za-z]{6,35}$' then perform public._fail('The UPI reference should be 6 to 35 letters or digits.'); end if;
  update public.settlements set status = 'marked_paid', marked_paid_at = now(), upi_ref = r where id = sid;
  select name into gname from public.groups where id = s.group_id;
  perform public._notify(s.to_user, s.group_id, 'payment_marked', 'Confirm a payment',
    public._first_name(u) || ' marked ' || public._inr(s.amount) || ' to you as paid'
      || case when s.method = 'cash' then ' in cash' else ' via UPI' end
      || ' for ' || gname || '.' || coalesce(' Ref: ' || r || '.', '') || ' Confirm?',
    jsonb_build_object('settlement_id', sid, 'amount', s.amount, 'method', s.method, 'upi_ref', r));
  perform public._log(s.group_id, u, 'payment_marked',
    public._first_name(u) || ' marked ' || public._inr(s.amount) || ' to ' || public._first_name(s.to_user) || ' as paid', s.amount,
    jsonb_build_object('settlement_id', sid));
end $$;

-- Only the receiver can confirm or decline.
create function public.respond_settlement(sid uuid, accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public._uid(); s public.settlements; gname text;
begin
  select * into s from public.settlements where id = sid for update;
  if s.id is null or s.to_user <> u then perform public._fail('Only the person being paid can confirm this payment.'); end if;
  if s.status <> 'marked_paid' then perform public._fail('This payment has already been answered.'); end if;
  select name into gname from public.groups where id = s.group_id;
  if accept then
    update public.settlements set status = 'completed', completed_at = now() where id = sid;
    perform public._notify(s.from_user, s.group_id, 'payment_confirmed', 'Payment confirmed',
      public._first_name(u) || ' confirmed your payment of ' || public._inr(s.amount) || ' for ' || gname || '.',
      jsonb_build_object('settlement_id', sid, 'amount', s.amount));
    perform public._log(s.group_id, u, 'payment_confirmed',
      public._first_name(u) || ' confirmed ' || public._inr(s.amount) || ' from ' || public._first_name(s.from_user), s.amount,
      jsonb_build_object('settlement_id', sid));
    perform public._refresh_debt_since(s.group_id);
  else
    update public.settlements set status = 'declined', declined_at = now() where id = sid;
    perform public._notify(s.from_user, s.group_id, 'payment_declined', 'Payment not received',
      public._first_name(u) || ' has not received your payment of ' || public._inr(s.amount) || ' for ' || gname
        || '. Your balance is unchanged; you can try again.',
      jsonb_build_object('settlement_id', sid, 'amount', s.amount));
    perform public._log(s.group_id, u, 'payment_declined',
      public._first_name(u) || ' did not receive ' || public._inr(s.amount) || ' from ' || public._first_name(s.from_user), s.amount,
      jsonb_build_object('settlement_id', sid));
  end if;
  update public.notifications set read_at = coalesce(read_at, now())
    where user_id = u and type = 'payment_marked' and payload ->> 'settlement_id' = sid::text;
end $$;

-- The split-sum constraint triggers fire at commit as the calling role, after function
-- permissions are locked down, so they must not call other helper functions.
create or replace function public._check_split_sum() returns trigger
language plpgsql security definer set search_path = '' as $$
declare eid uuid := coalesce(new.expense_id, old.expense_id); t bigint; s bigint;
begin
  select total_amount into t from public.expenses where id = eid;
  if t is null then return null; end if;
  select coalesce(sum(amount_owed), 0) into s from public.expense_splits where expense_id = eid;
  if s <> t then raise exception 'expense % splits sum to % but total is %', eid, s, t; end if;
  return null;
end $$;

create or replace function public._check_expense_sum() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s bigint;
begin
  select coalesce(sum(amount_owed), 0) into s from public.expense_splits where expense_id = new.id;
  if s <> new.total_amount then raise exception 'expense % splits sum to % but total is %', new.id, s, new.total_amount; end if;
  return null;
end $$;
