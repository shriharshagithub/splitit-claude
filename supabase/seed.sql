-- SplitIt demo data. Safe to run more than once. Remove it with supabase/clear-demo.sql.
-- 5 people (password for all: SplitIt@2026), "Goa Trip" (5 people) and "Flat 402" (3 people),
-- 12 expenses (₹150 to ₹8,000, all four split types), and 3 payments: 1 confirmed, 1 waiting for confirmation, 1 started.
-- Demo emails use @example.com (they never receive mail) and demo UPI IDs use @example, which no UPI app accepts,
-- so a test payment can never reach a real person.
do $$
declare
  pw text := extensions.crypt('SplitIt@2026', extensions.gen_salt('bf'));
  priya uuid := 'd0000000-0000-4000-8000-000000000001';
  ravi uuid := 'd0000000-0000-4000-8000-000000000002';
  ananya uuid := 'd0000000-0000-4000-8000-000000000003';
  arjun uuid := 'd0000000-0000-4000-8000-000000000004';
  meera uuid := 'd0000000-0000-4000-8000-000000000005';
  goa uuid; flat uuid; s uuid;
  u record;
  procedure_as text;
begin
  if exists (select 1 from auth.users where id = priya) then
    raise notice 'Demo data already present'; return;
  end if;
  for u in select * from (values
    (priya, 'Priya Sharma', '919000000001', 'priya.demo@example.com', 'priya.demo@example'),
    (ravi, 'Ravi Kumar', '919000000002', 'ravi.demo@example.com', 'ravi.demo@example'),
    (ananya, 'Ananya Iyer', '919000000003', 'ananya.demo@example.com', 'ananya.demo@example'),
    (arjun, 'Arjun Mehta', '919000000004', 'arjun.demo@example.com', null),
    (meera, 'Meera Nair', '919000000005', 'meera.demo@example.com', 'meera.demo@example')
  ) as t(id, name, phone, email, upi) loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, phone, phone_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new,
      email_change, phone_change, phone_change_token, email_change_token_current, reauthentication_token)
    values ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, pw, now(), u.phone, now(),
      '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', u.name, 'phone', u.phone), now() - interval '20 days', now(),
      '', '', '', '', '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, u.id::text, 'email', jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), now(), now(), now());
    update public.profiles set upi_id = u.upi where id = u.id;
  end loop;

  -- Act as Priya / Ravi so every write goes through the same checked functions the app uses.
  perform set_config('request.jwt.claims', json_build_object('sub', priya, 'role', 'authenticated')::text, true);
  goa := public.create_group('Goa Trip', 'trip');
  perform public.add_member(goa, '9000000002'); perform public.add_member(goa, '9000000003');
  perform public.add_member(goa, '9000000004'); perform public.add_member(goa, '9000000005');
  perform set_config('request.jwt.claims', json_build_object('sub', ravi, 'role', 'authenticated')::text, true);
  flat := public.create_group('Flat 402', 'flat');
  perform public.add_member(flat, '9000000001'); perform public.add_member(flat, '9000000004');

  perform set_config('request.jwt.claims', json_build_object('sub', priya, 'role', 'authenticated')::text, true);
  perform public.save_expense(gen_random_uuid(), goa, priya, 800000, 'Villa booking, 2 nights', 'stay', current_date - 12, 'equal', array[priya, ravi, ananya, arjun, meera], '{}');
  perform public.save_expense(gen_random_uuid(), goa, ravi, 240000, 'Scooter rentals', 'travel', current_date - 11, 'exact', array[priya, ravi, ananya, arjun, meera],
    jsonb_build_object(priya, 60000, ravi, 60000, ananya, 40000, arjun, 40000, meera, 40000));
  perform public.save_expense(gen_random_uuid(), goa, ananya, 356000, 'Seafood dinner at Britto''s', 'food', current_date - 11, 'percentage', array[priya, ravi, ananya, arjun, meera],
    jsonb_build_object(priya, 2000, ravi, 2500, ananya, 2000, arjun, 2000, meera, 1500));
  perform public.save_expense(gen_random_uuid(), goa, meera, 150000, 'Dudhsagar trip tickets', 'fun', current_date - 10, 'shares', array[priya, ravi, ananya, arjun, meera],
    jsonb_build_object(priya, 1, ravi, 1, ananya, 1, arjun, 2, meera, 1));
  perform public.save_expense(gen_random_uuid(), goa, arjun, 45000, 'Petrol', 'travel', current_date - 10, 'equal', array[priya, ravi, ananya, arjun, meera], '{}');
  perform public.save_expense(gen_random_uuid(), goa, priya, 15000, 'Chai and vada pav', 'food', current_date - 9, 'equal', array[priya, ananya, meera], '{}');
  perform public.save_expense(gen_random_uuid(), goa, ravi, 189000, 'Beach shack drinks', 'food', current_date - 9, 'equal', array[priya, ravi, ananya, arjun, meera], '{}');
  perform set_config('request.jwt.claims', json_build_object('sub', ravi, 'role', 'authenticated')::text, true);
  perform public.save_expense(gen_random_uuid(), flat, ravi, 450000, 'November electricity + internet', 'rent', current_date - 8, 'equal', array[priya, ravi, arjun], '{}');
  perform public.save_expense(gen_random_uuid(), flat, priya, 263500, 'Monthly groceries (BigBasket)', 'groceries', current_date - 7, 'shares', array[priya, ravi, arjun],
    jsonb_build_object(priya, 2, ravi, 1, arjun, 1));
  perform public.save_expense(gen_random_uuid(), flat, arjun, 60000, 'Cooking gas cylinder', 'rent', current_date - 6, 'equal', array[priya, ravi, arjun], '{}');
  perform public.save_expense(gen_random_uuid(), flat, ravi, 32000, 'Cleaning supplies', 'groceries', current_date - 5, 'exact', array[priya, ravi, arjun],
    jsonb_build_object(priya, 12000, ravi, 10000, arjun, 10000));
  perform public.save_expense(gen_random_uuid(), flat, priya, 120000, 'Pizza night', 'food', current_date - 2, 'percentage', array[priya, ravi, arjun],
    jsonb_build_object(priya, 4000, ravi, 3000, arjun, 3000));

  -- Payments: Meera paid Priya (confirmed); Arjun says he paid Ravi (waiting); Ananya started paying Priya (pending).
  perform set_config('request.jwt.claims', json_build_object('sub', meera, 'role', 'authenticated')::text, true);
  s := public.start_settlement(goa, priya, 100000, 'upi');
  perform public.mark_settlement_paid(s, '431298765432');
  perform set_config('request.jwt.claims', json_build_object('sub', priya, 'role', 'authenticated')::text, true);
  perform public.respond_settlement(s, true);
  perform set_config('request.jwt.claims', json_build_object('sub', arjun, 'role', 'authenticated')::text, true);
  s := public.start_settlement(flat, ravi, 50000, 'cash');
  perform public.mark_settlement_paid(s, null);
  perform set_config('request.jwt.claims', json_build_object('sub', ananya, 'role', 'authenticated')::text, true);
  perform public.start_settlement(goa, priya, 80000, 'upi');
  perform set_config('request.jwt.claims', '', true);

  -- Make the history look real: expenses were added on their dates, the waiting claim is 4 days old.
  update public.expenses set created_at = expense_date + time '20:00' - interval '5 hours 30 minutes', updated_at = expense_date + time '20:00' - interval '5 hours 30 minutes'
  where group_id in (goa, flat);
  update public.settlements set marked_paid_at = now() - interval '4 days', created_at = now() - interval '4 days' where group_id = flat and status = 'marked_paid';
end $$;
