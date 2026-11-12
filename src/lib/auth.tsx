import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { normalizeIndianPhone } from '@/core';
import { WEB_URL } from './config';
import { queryClient } from './query';
import { callFunction, supabase } from './supabase';

interface AuthState { session: Session | null; ready: boolean; userId: string | null }
const Ctx = createContext<AuthState>({ session: null, ready: false, userId: null });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s?.access_token) supabase.realtime.setAuth(s.access_token);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return <Ctx.Provider value={{ session, ready, userId: session?.user.id ?? null }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

export function useUserId(): string {
  const { userId } = useAuth();
  return userId ?? '';
}

export async function logIn(identifier: string, password: string) {
  const id = identifier.trim();
  if (id.includes('@')) {
    const { error } = await supabase.auth.signInWithPassword({ email: id.toLowerCase(), password });
    if (error) throw new Error(/invalid/i.test(error.message) ? 'That login or password is not right.' : error.message);
    return;
  }
  if (!normalizeIndianPhone(id)) throw new Error('Enter your email or a 10-digit mobile number.');
  const r = await callFunction<{ session?: { access_token: string; refresh_token: string }; error?: string }>('login', { identifier: id, password });
  if (!r.session) throw new Error(r.error ?? 'That login or password is not right.');
  const { error } = await supabase.auth.setSession({ access_token: r.session.access_token, refresh_token: r.session.refresh_token });
  if (error) throw error;
}

export async function signUp(o: { full_name: string; email: string; phone: string; password: string }) {
  await callFunction('signup', o);
  await supabase.auth.signInWithPassword({ email: o.email.trim().toLowerCase(), password: o.password });
}

export async function sendPasswordReset(email: string): Promise<string> {
  const r = await callFunction<{ message: string }>('password-reset', { email });
  return r.message;
}

/** Google sign-in. Web: full-page redirect. Native: in-app browser, then exchange the code. */
export async function signInWithGoogle() {
  const redirectTo = Platform.OS === 'web' ? `${WEB_URL}/` : Linking.createURL('/auth-callback');
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: Platform.OS !== 'web' } });
  if (error) throw error;
  if (Platform.OS === 'web' || !data?.url) return;
  const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (res.type !== 'success') return;
  const code = new URL(res.url).searchParams.get('code');
  if (code) {
    const { error: e2 } = await supabase.auth.exchangeCodeForSession(code);
    if (e2) throw e2;
  }
}

/** Is Google switched on in Supabase? (public settings endpoint) */
export async function googleEnabled(): Promise<boolean> {
  try {
    const { SUPABASE_URL, SUPABASE_KEY } = await import('./config');
    const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } });
    const j = await r.json();
    return !!j?.external?.google;
  } catch {
    return false;
  }
}

export async function logOut() {
  await supabase.auth.signOut();
  queryClient.clear();
}
