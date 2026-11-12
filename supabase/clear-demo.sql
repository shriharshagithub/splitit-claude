-- Removes the demo data from supabase/seed.sql: the 5 demo people, their groups, expenses and payments.
-- Real accounts and real groups are not touched (unless a real person joined a demo group; they just lose that group).
-- Run it in Supabase → SQL Editor.
delete from public.groups where created_by in (select id from auth.users where email like '%.demo@example.com');
delete from auth.users where email like '%.demo@example.com';
