-- Security advisor clean-up.
-- 1. Internal helpers and trigger functions are not part of the app's API: nobody calls them directly.
revoke execute on function
  public.broadcast_change(), public.broadcast_profile_change(), public.email_on_invite(), public.email_on_notification(),
  public.check_expense_total(), public.handle_new_user(), public.handle_user_email_change(), public.safe_uuid(text)
from public, anon, authenticated;
revoke execute on function public.can_listen(text) from public, anon;
-- 2. pg_net lives in the extensions schema, not public (its functions stay in schema "net").
drop extension if exists pg_net;
create extension pg_net with schema extensions;
