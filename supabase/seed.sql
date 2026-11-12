-- Demo data. Every seeded account's password is: SplitIt@2026
-- Demo UPI IDs use the non-existent handle @example so a test payment can never reach a real person.
-- Phone login works with the numbers below (10 digits or +91 form).
-- Run as postgres. Expenses and settlements go through the same functions the app uses.

do $$
declare
  pw text := extensions.crypt('SplitIt@2026', extensions.gen_salt('bf'));
  u record;
begin
  for u in select * from (values
    ('11111111-1111-4111-8111-111111111111'::uuid, 'Priya Sharma', '919886054321', 'priya@example.com'),
    ('22222222-2222-4222-8222-222222222222'::uuid, 'Ravi Kumar',   '919845012345', 'ravi@example.com'),
    ('33333333-3333-4333-8333-333333333333'::uuid, 'Ananya Iyer',  '919900011223', 'ananya@example.com'),
    ('44444444-4444-4444-8444-444444444444'::uuid, 'Arjun Mehta',  '919900045678', 'arjun@example.com'),
    ('55555555-5555-4555-8555-555555555555'::uuid, 'Meera Nair',   '919811122334', 'meera@example.com')
  ) as t(id, name, phone, email)
  loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, phone, phone_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change, phone_change, phone_change_token, email_change_token_current, reauthentication_token)
    values ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, pw, now(), u.phone, now(),
      '{"provider":"email","providers":["email","phone"]}', jsonb_build_object('full_name', u.name), now() - interval '20 days', now(),
      '', '', '', '', '', '', '', '')
    on conflict (id) do nothing;
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, u.id::text, 'email', jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), now(), now(), now()),
           (gen_random_uuid(), u.id, u.phone, 'phone', jsonb_build_object('sub', u.id::text, 'phone', u.phone, 'phone_verified', true), now(), now(), now())
    on conflict do nothing;
  end loop;
  update public.profiles set upi_id = case id
    when '11111111-1111-4111-8111-111111111111' then 'priya.demo@example'
    when '22222222-2222-4222-8222-222222222222' then 'ravi.demo@example'
    when '33333333-3333-4333-8333-333333333333' then 'ananya.demo@example'
    when '44444444-4444-4444-8444-444444444444' then 'arjun.demo@example'
    when '55555555-5555-4555-8555-555555555555' then 'meera.demo@example' end
  where upi_id is null and id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555');
end $$;

create or replace function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
$$;

create or replace function pg_temp.exp(g uuid, payer uuid, total bigint, descr text, cat text, days_ago int, st text, inputs jsonb)
returns void language sql as $$
  select pg_temp.as_user(payer);
  select public.save_expense(jsonb_build_object('group_id', g, 'paid_by', payer, 'total_amount', total, 'description', descr,
    'category', cat, 'expense_date', current_date - days_ago, 'split_type', st, 'inputs', inputs));
$$;

do $$
declare
  p uuid := '11111111-1111-4111-8111-111111111111';
  r uuid := '22222222-2222-4222-8222-222222222222';
  a uuid := '33333333-3333-4333-8333-333333333333';
  j uuid := '44444444-4444-4444-8444-444444444444';
  m uuid := '55555555-5555-4555-8555-555555555555';
  goa uuid; flat uuid; sid uuid;
  five jsonb;
begin
  if exists (select 1 from public.groups where name = 'Goa Trip') then return; end if;

  perform pg_temp.as_user(p);
  goa := (public.create_group('Goa Trip', 'trip', array['+919845012345', 'ananya@example.com', '9900045678', 'meera@example.com']) ->> 'group_id')::uuid;
  perform pg_temp.as_user(r);
  flat := (public.create_group('Flat 402', 'flat', array['priya@example.com', '+91 99000 45678']) ->> 'group_id')::uuid;

  five := jsonb_build_array(jsonb_build_object('user_id', p), jsonb_build_object('user_id', r), jsonb_build_object('user_id', a),
                            jsonb_build_object('user_id', j), jsonb_build_object('user_id', m));

  -- Goa Trip: 8 expenses
  perform pg_temp.exp(goa, p, 800000, 'Villa booking, 3 nights', 'stay', 9, 'equal', five);
  perform pg_temp.exp(goa, r, 200000, 'Scooter rental', 'travel', 8, 'equal', five);
  perform pg_temp.exp(goa, j, 600000, 'Parasailing at Calangute', 'entertainment', 7, 'exact', jsonb_build_array(
    jsonb_build_object('user_id', p, 'value', 150000), jsonb_build_object('user_id', r, 'value', 150000),
    jsonb_build_object('user_id', a, 'value', 100000), jsonb_build_object('user_id', j, 'value', 100000),
    jsonb_build_object('user_id', m, 'value', 100000)));
  perform pg_temp.exp(goa, r, 425000, 'Dinner at Fisherman''s Wharf', 'food', 7, 'shares', jsonb_build_array(
    jsonb_build_object('user_id', p, 'value', 1), jsonb_build_object('user_id', r, 'value', 2),
    jsonb_build_object('user_id', a, 'value', 1), jsonb_build_object('user_id', j, 'value', 1)));
  perform pg_temp.exp(goa, m, 115000, 'Groceries for the villa', 'groceries', 8, 'percentage', jsonb_build_array(
    jsonb_build_object('user_id', p, 'value', 4000), jsonb_build_object('user_id', a, 'value', 3000),
    jsonb_build_object('user_id', m, 'value', 3000)));
  perform pg_temp.exp(goa, a, 180000, 'Cab to Dabolim airport', 'travel', 6, 'equal', five);
  perform pg_temp.exp(goa, p, 234000, 'Beach shack lunch', 'food', 6, 'percentage', jsonb_build_array(
    jsonb_build_object('user_id', p, 'value', 2000), jsonb_build_object('user_id', r, 'value', 2000),
    jsonb_build_object('user_id', a, 'value', 2000), jsonb_build_object('user_id', j, 'value', 2000),
    jsonb_build_object('user_id', m, 'value', 2000)));
  perform pg_temp.exp(goa, j, 375000, 'Water sports tickets', 'entertainment', 6, 'shares', jsonb_build_array(
    jsonb_build_object('user_id', p, 'value', 1), jsonb_build_object('user_id', r, 'value', 1),
    jsonb_build_object('user_id', a, 'value', 1), jsonb_build_object('user_id', j, 'value', 1),
    jsonb_build_object('user_id', m, 'value', 1)));

  -- Flat 402: 4 expenses
  perform pg_temp.exp(flat, r, 246000, 'Electricity bill, October', 'utilities', 12, 'equal',
    jsonb_build_array(jsonb_build_object('user_id', p), jsonb_build_object('user_id', r), jsonb_build_object('user_id', j)));
  perform pg_temp.exp(flat, p, 117900, 'Wi-Fi recharge', 'utilities', 10, 'equal',
    jsonb_build_array(jsonb_build_object('user_id', p), jsonb_build_object('user_id', r), jsonb_build_object('user_id', j)));
  perform pg_temp.exp(flat, j, 321550, 'Groceries from DMart', 'groceries', 5, 'exact', jsonb_build_array(
    jsonb_build_object('user_id', p, 'value', 100000), jsonb_build_object('user_id', r, 'value', 121550),
    jsonb_build_object('user_id', j, 'value', 100000)));
  perform pg_temp.exp(flat, p, 15000, 'Milk and bread', 'groceries', 4, 'equal',
    jsonb_build_array(jsonb_build_object('user_id', p), jsonb_build_object('user_id', r), jsonb_build_object('user_id', j)));

  -- Settlements: one completed (cash, Flat 402), one marked paid (UPI, Goa), one pending (UPI, Goa).
  perform pg_temp.as_user(p);
  sid := (public.start_settlement(flat, j, 50000, 'cash') ->> 'id')::uuid;
  perform public.mark_settlement_paid(sid, null);
  perform pg_temp.as_user(j);
  perform public.respond_settlement(sid, true);

  perform pg_temp.as_user(m);
  sid := (public.start_settlement(goa, p, 140000, 'upi') ->> 'id')::uuid;
  perform public.mark_settlement_paid(sid, '431209876543');

  perform pg_temp.as_user(a);
  perform public.start_settlement(goa, j, 150000, 'upi');

  -- Seeded debts are old enough for the 3-day reminder rule.
  update public.debt_since set since = now() - interval '6 days';
  update public.settlements set marked_paid_at = now() - interval '4 days' where status = 'marked_paid';
end $$;
