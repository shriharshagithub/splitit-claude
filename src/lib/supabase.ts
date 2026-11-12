import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { SUPABASE_KEY, SUPABASE_URL } from './config';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    // On web, Google sign-in comes back with the session in the URL.
    detectSessionInUrl: Platform.OS === 'web',
    flowType: 'pkce',
  },
});

/** Calls an edge function and returns its JSON, turning errors into plain-language messages. */
export async function callFunction<T = any>(name: string, body: unknown): Promise<T> {
  const { data: s } = await supabase.auth.getSession();
  let r: Response;
  try {
    r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${s.session?.access_token ?? SUPABASE_KEY}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('No connection. Check your internet and try again.');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok && j?.error) throw new Error(j.error);
  if (!r.ok && !('ok' in j)) throw new Error('Something went wrong. Please try again.');
  return j as T;
}
