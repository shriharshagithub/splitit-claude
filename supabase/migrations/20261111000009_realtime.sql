-- Live updates: the app listens for changes to these tables and refreshes its screens.
-- Supabase Realtime applies each table's row-level security, so people only hear about their own groups.
alter publication supabase_realtime add table public.expenses, public.settlements, public.group_members, public.notifications;
