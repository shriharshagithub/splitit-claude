-- Fix: the commit-time total check read new.expense_id on the expenses table, which has no such column.
create or replace function public.check_expense_total() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  eid uuid;
  t bigint;
  s bigint;
begin
  if tg_table_name = 'expenses' then
    eid := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    eid := case when tg_op = 'DELETE' then old.expense_id else new.expense_id end;
  end if;
  select total_amount into t from public.expenses where id = eid;
  if t is null then return null; end if;  -- expense deleted
  select coalesce(sum(amount_owed), 0) into s from public.expense_splits where expense_id = eid;
  if s <> t then
    raise exception 'splits (%) do not add up to the expense total (%)', s, t using errcode = '23514';
  end if;
  return null;
end $$;
