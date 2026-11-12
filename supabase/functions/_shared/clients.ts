import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

/** Full-access client. Only for work the function has already authorised. */
export function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Client acting as the caller, so row-level security applies. */
export function asUser(req: Request): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
}

export function anon(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Database -> function calls carry the Vault hook secret. */
export async function checkHookSecret(req: Request): Promise<boolean> {
  const s = req.headers.get('x-hook-secret');
  if (!s) return false;
  const { data, error } = await admin().rpc('check_hook_secret', { p: s });
  return !error && data === true;
}
