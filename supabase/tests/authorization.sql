-- Authorisation and arithmetic checks. Run as postgres against a seeded database.
-- Returns one row per check with pass = true/false. Leaves no data behind.
-- Usage: psql "$DATABASE_URL" -f supabase/tests/authorization.sql

create or replace function pg_temp.authz_checks() returns table (check_name text, pass boolean, detail text)
language plpgsql as $fn$
declare
  outsider uuid := '99999999-9999-4999-8999-999999999999';
  p uuid := '11111111-1111-4111-8111-111111111111';
  r uuid := '22222222-2222-4222-8222-222222222222';
  m uuid := '55555555-5555-4555-8555-555555555555';
  goa uuid := (select id from public.groups where name = 'Goa Trip');
  pexp uuid := (select id from public.expenses where group_id = (select id from public.groups where name = 'Goa Trip') and created_by = '11111111-1111-4111-8111-111111111111' limit 1);
  marked uuid := (select id from public.settlements where status = 'marked_paid' limit 1);
  n bigint;
  results text[] := '{}';
  -- run a statement as a user; return 'ok' or the error message
  procedure_result text;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', outsider, 'authenticated', 'authenticated', 'outsider@example.com', '', now(),
    '{}', '{"full_name":"Kabir Outsider"}', now(), now(), '', '', '', '')
  on conflict (id) do nothing;

  -- ----- reads as an outsider -----
  perform set_config('request.jwt.claims', json_build_object('sub', outsider, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.groups where id = goa;            results := results || format('outsider sees group|%s', n = 0);
  select count(*) into n from public.group_members where group_id = goa; results := results || format('outsider sees members|%s', n = 0);
  select count(*) into n from public.expenses;                         results := results || format('outsider sees expenses|%s', n = 0);
  select count(*) into n from public.expense_splits;                   results := results || format('outsider sees splits|%s', n = 0);
  select count(*) into n from public.receipt_items;                    results := results || format('outsider sees receipt items|%s', n = 0);
  select count(*) into n from public.settlements;                      results := results || format('outsider sees settlements|%s', n = 0);
  select count(*) into n from public.activity;                         results := results || format('outsider sees activity|%s', n = 0);
  select count(*) into n from public.reminders;                        results := results || format('outsider sees reminders|%s', n = 0);
  select count(*) into n from public.group_invites;                    results := results || format('outsider sees invites|%s', n = 0);
  select count(*) into n from public.notifications;                    results := results || format('outsider sees others notifications|%s', n = 0);
  select count(*) into n from public.profiles where id <> outsider;    results := results || format('outsider sees other profiles|%s', n = 0);
  select count(*) into n from public.debt_since;                       results := results || format('outsider sees debt_since|%s', n = 0);
  update public.profiles set upi_id = 'evil@okaxis' where id = p;
  get diagnostics n = row_count;                                       results := results || format('outsider edits another profile|%s', n = 0);
  update public.notifications set read_at = now() where user_id = p;
  get diagnostics n = row_count;                                       results := results || format('outsider marks others notifications|%s', n = 0);
  reset role;

  -- ----- calls as an outsider: every one must fail -----
  for procedure_result in
    select x from unnest(array[
      format('select * from public.group_nets(%L)', goa),
      format('select * from public.group_expenses(%L)', goa),
      format('select public.save_expense(%L::jsonb)', json_build_object('group_id', goa, 'paid_by', outsider, 'total_amount', 100,
        'description', 'x', 'split_type', 'equal', 'inputs', json_build_array(json_build_object('user_id', outsider)))),
      format('select public.save_expense(%L::jsonb)', json_build_object('id', pexp, 'group_id', goa, 'paid_by', p, 'total_amount', 100,
        'description', 'hijack', 'split_type', 'equal', 'inputs', json_build_array(json_build_object('user_id', p)))),
      format('select public.delete_expense(%L)', pexp),
      format('select public.start_settlement(%L, %L, 100, ''cash'')', goa, p),
      format('select public.mark_settlement_paid(%L, null)', marked),
      format('select public.respond_settlement(%L, true)', marked),
      format('select public.request_payment(%L, %L, 100)', goa, m),
      format('select public.add_group_member(%L, ''outsider@example.com'')', goa),
      format('select public.update_group(%L, ''pwned'', ''trip'')', goa),
      format('select public.delete_group(%L)', goa),
      format('select public.remove_group_member(%L, %L)', goa, m),
      format('insert into public.group_members (group_id, user_id) values (%L, %L)', goa, outsider),
      format('insert into public.expenses (group_id, paid_by, total_amount, description, split_type, created_by) values (%L, %L, 1, ''x'', ''equal'', %L)', goa, outsider, outsider),
      format('update public.settlements set status = ''completed'' where id = %L', marked),
      'select public._group_nets(gen_random_uuid())',
      'select public._join_group(gen_random_uuid(), gen_random_uuid(), gen_random_uuid())'
    ]) x
  loop
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', outsider, 'role', 'authenticated')::text, true);
      set local role authenticated;
      execute procedure_result;
      get diagnostics n = row_count;
      reset role;
      -- a plain UPDATE that silently matches nothing is also a pass
      results := results || format('outsider: %s|%s', left(procedure_result, 70), procedure_result like 'update%' and n = 0);
    exception when others then
      reset role;
      results := results || format('outsider: %s|true|%s', left(procedure_result, 70), sqlerrm);
    end;
  end loop;

  -- ----- role checks inside the group -----
  for procedure_result in
    select x from unnest(array[
      -- Ravi is a member of Goa Trip but not its admin, and did not create Priya's expense
      format('%s|select public.delete_expense(%L)', r, pexp),
      format('%s|select public.update_group(%L, ''Renamed'', ''trip'')', r, goa),
      format('%s|select public.add_group_member(%L, ''someone@example.com'')', r, goa),
      -- only the receiver (Priya) may confirm Meera's claim; Meera and Ravi may not
      format('%s|select public.respond_settlement(%L, true)', m, marked),
      format('%s|select public.respond_settlement(%L, true)', r, marked),
      -- only the payer (Meera) may mark it paid
      format('%s|select public.mark_settlement_paid(%L, null)', p, marked),
      -- anon cannot read anything
      'anon|select count(*) from public.expenses'
    ]) x
  loop
    begin
      if split_part(procedure_result, '|', 1) = 'anon' then
        set local role anon;
      else
        perform set_config('request.jwt.claims', json_build_object('sub', split_part(procedure_result, '|', 1)::uuid, 'role', 'authenticated')::text, true);
        set local role authenticated;
      end if;
      execute split_part(procedure_result, '|', 2);
      reset role;
      results := results || format('role: %s|false', left(split_part(procedure_result, '|', 2), 70));
    exception when others then
      reset role;
      results := results || format('role: %s|true|%s', left(split_part(procedure_result, '|', 2), 70), sqlerrm);
    end;
  end loop;

  -- ----- positive path: receiver confirms, balances move, then undo -----
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.respond_settlement(marked, true);
    select net into n from public.group_nets(goa) where user_id = m;
    reset role;
    results := results || format('confirm clears Meera debt by 1400.00|%s|net now %s', n = -377300 + 140000, n);
    raise exception 'rollback-positive-path';
  exception when others then
    reset role;
    if sqlerrm <> 'rollback-positive-path' then results := results || format('confirm path|false|%s', sqlerrm); end if;
  end;

  -- ----- arithmetic invariants -----
  select count(*) into n from public.expenses e
    where e.total_amount <> (select coalesce(sum(amount_owed), 0) from public.expense_splits s where s.expense_id = e.id);
  results := results || format('every expense splits sum to total|%s', n = 0);
  select count(*) into n from (select g.id, sum(x.net) s from public.groups g, public._group_nets(g.id) x group by g.id) q where q.s <> 0;
  results := results || format('every group nets sum to zero|%s', n = 0);
  select count(*) into n from public.settlements where status = 'marked_paid';
  results := results || format('marked_paid alone does not clear debt (still 1 open claim)|%s', n = 1);

  delete from auth.users where id = outsider;

  return query select split_part(x, '|', 1), split_part(x, '|', 2)::boolean, nullif(split_part(x, '|', 3), '') from unnest(results) x;
end $fn$;

select * from pg_temp.authz_checks();
