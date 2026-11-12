-- Removes the throwaway accounts created by the automated tests (e2e-...@example.com) and their groups.
delete from public.groups where created_by in (select id from auth.users where email like 'e2e-%@example.com');
delete from auth.users where email like 'e2e-%@example.com' or email like 'dup-%@example.com';
