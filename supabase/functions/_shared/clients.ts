import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A client that acts as the calling user, so row-level security applies. */
export function userClient(req: Request): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Database hooks and the cron job send the Vault hook secret; check it against the database. */
export async function verifyHook(req: Request): Promise<boolean> {
  const secret = req.headers.get('x-hook-secret');
  if (!secret) return false;
  const { data, error } = await adminClient().rpc('_verify_hook', { secret });
  return !error && data === true;
}
