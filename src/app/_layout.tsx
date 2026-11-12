import AsyncStorage from '@react-native-async-storage/async-storage';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Loading } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth';
import { onNetworkChange, isOnline, startNetworkWatch } from '@/lib/network';
import { outbox } from '@/lib/outboxInstance';
import { persister, queryClient } from '@/lib/query';
import { useLiveUser } from '@/lib/realtime';
import { Sentry, sentryOn } from '@/lib/sentry';
import { supabase } from '@/lib/supabase';
import { useColors } from '@/lib/theme';
import { PENDING_JOIN } from '@/lib/config';

const PUBLIC = new Set(['login', 'reset-password', 'join']);

function Gate() {
  const { session, ready } = useAuth();
  const seg = useSegments();
  const c = useColors();
  useLiveUser();

  useEffect(() => {
    if (!ready) return;
    const isPublic = PUBLIC.has(String(seg[0] ?? ''));
    if (!session && !isPublic) router.replace('/login');
    if (session && seg[0] === 'login') {
      (async () => {
        const code = await AsyncStorage.getItem(PENDING_JOIN);
        if (code) { await AsyncStorage.removeItem(PENDING_JOIN); router.replace(`/join/${code}`); }
        else router.replace('/');
      })();
    }
    if (session) {
      supabase.rpc('claim_my_invites').then(({ data }) => { if (data) queryClient.invalidateQueries(); });
      void outbox.flush();
    }
  }, [ready, session, seg]);

  if (!ready) return <View style={{ flex: 1, backgroundColor: c.bg, justifyContent: 'center' }}><Loading /></View>;
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }} />
    </>
  );
}

function RootLayout() {
  useEffect(() => {
    const stop = startNetworkWatch();
    void outbox.load().then(() => outbox.flush());
    const off = onNetworkChange(() => { if (isOnline()) void outbox.flush().then(() => queryClient.invalidateQueries()); });
    const sub = outbox.subscribe(() => { if (outbox.count() === 0) queryClient.invalidateQueries(); });
    return () => { stop(); off(); sub(); };
  }, []);
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.title = 'SplitIt';
  }, []);
  return (
    <SafeAreaProvider>
      <ErrorBoundary screen="root">
        <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 7 * 24 * 3600_000, buster: 'v1' }}>
          <AuthProvider>
            <Gate />
          </AuthProvider>
        </PersistQueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

export default sentryOn ? Sentry.wrap(RootLayout) : RootLayout;
