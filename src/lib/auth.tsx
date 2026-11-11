import type { Session } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import * as Sentry from '@sentry/react-native';
import { getMyProfile } from './api';
import { clearOffline } from './offline';
import { queryClient, qk } from './query';
import { supabase } from './supabase';
import type { Profile } from './types';

interface AuthState {
  session: Session | null;
  loading: boolean;
  recovering: boolean;
  profile: Profile | undefined;
  signOut: () => Promise<void>;
  clearRecovery: () => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    Sentry.setUser(userId ? { id: userId } : null);
  }, [userId]);

  const { data: profile } = useQuery({
    queryKey: qk.profile(userId ?? 'none'),
    queryFn: () => getMyProfile(userId!),
    enabled: Boolean(userId),
  });

  const signOut = async () => {
    await supabase.auth.signOut().catch(() => undefined);
    await clearOffline();
    queryClient.clear();
  };

  return (
    <Ctx.Provider value={{ session, loading, recovering, profile, signOut, clearRecovery: () => setRecovering(false) }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

export function useMe(): string {
  return useAuth().session?.user.id ?? '';
}
