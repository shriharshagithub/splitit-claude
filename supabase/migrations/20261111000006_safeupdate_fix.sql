-- Supabase's API runs with pg_safeupdate, which rejects UPDATE without WHERE, even on temp tables.
-- compute_splits updated its scratch table that way; add explicit WHERE clauses.
create or replace function public.compute_splits(p_total bigint, p_type public.split_type, p_inputs jsonb, p_payer uuid)
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
    update _si set amt = p_total / n where true;
  elsif p_type = 'exact' then
    if s <> p_total then perform public._fail('Splits add up to ' || public._inr(s) || ' but the total is ' || public._inr(p_total) || '.'); end if;
    update _si set amt = val where true;
  elsif p_type = 'percentage' then
    if s <> 10000 then perform public._fail('Percentages must add up to 100%.'); end if;
    update _si set amt = (p_total * val) / 10000 where true;
  else
    if s <= 0 then perform public._fail('Give at least one person a share.'); end if;
    update _si set amt = (p_total * val) / s where true;
  end if;

  select p_total - sum(amt) into rem from _si;
  if rem <> 0 then
    if exists (select 1 from _si where uid = p_payer) then update _si set amt = amt + rem where uid = p_payer;
    else insert into _si (uid, val, amt) values (p_payer, 0, rem); end if;
  end if;
  return query select uid, amt from _si where amt > 0;
end $$;

