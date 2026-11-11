import { AnekLatin_600SemiBold, AnekLatin_700Bold, useFonts as useAnek } from '@expo-google-fonts/anek-latin';
import { JetBrainsMono_500Medium, JetBrainsMono_600SemiBold } from '@expo-google-fonts/jetbrains-mono';
import { Mukta_400Regular, Mukta_500Medium, Mukta_600SemiBold } from '@expo-google-fonts/mukta';
import * as Sentry from '@sentry/react-native';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { router, Stack, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform, useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/lib/auth';
import { initOffline } from '@/lib/offline';
import { invalidateMoney, persistMaxAge, persister, queryClient } from '@/lib/query';
import { useColors } from '@/theme';

const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
Sentry.init({
  dsn: SENTRY_DSN,
  enabled: Boolean(SENTRY_DSN),
  sendDefaultPii: false,
  tracesSampleRate: 0.2,
  integrations: [Sentry.expoRouterIntegration()],
  environment: __DEV__ ? 'development' : 'production',
});

SplashScreen.preventAutoHideAsync().catch(() => undefined);

const PUBLIC = new Set(['login', 'reset-password', 'invite']);

function Gate() {
  const { session, loading, recovering } = useAuth();
  const segments = useSegments();
  const c = useColors();
  useEffect(() => {
    if (loading) return;
    const top = segments[0] ?? '';
    if (recovering && top !== 'reset-password') router.replace('/reset-password');
    else if (!session && !PUBLIC.has(top)) router.replace('/login');
    else if (session && top === 'login') router.replace('/');
  }, [session, loading, recovering, segments]);
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.ground } }}>
      <Stack.Screen name="group/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="group/[id]/expense" options={{ presentation: 'modal' }} />
      <Stack.Screen name="group/[id]/scan" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

function RootLayout() {
  const [fontsLoaded, fontError] = useAnek({
    AnekLatin_600SemiBold, AnekLatin_700Bold, Mukta_400Regular, Mukta_500Medium, Mukta_600SemiBold,
    JetBrainsMono_500Medium, JetBrainsMono_600SemiBold,
  });
  const [offlineReady, setOfflineReady] = useState(false);
  const scheme = useColorScheme();
  const c = useColors();

  useEffect(() => {
    void initOffline(() => invalidateMoney()).then(() => setOfflineReady(true));
  }, []);
  const ready = (fontsLoaded || fontError) && offlineReady;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);
  if (!ready) return <View style={{ flex: 1, backgroundColor: c.ground }} />;

  return (
    <SafeAreaProvider>
      <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: persistMaxAge }}>
        <AuthProvider>
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          {/* On wide screens (desktop browsers) show the app as a phone-width column. */}
          <View style={{ flex: 1, backgroundColor: c.sunken }}>
            <View style={{ flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: c.ground, ...(Platform.OS === 'web' ? { borderLeftWidth: 1, borderRightWidth: 1, borderColor: c.line } : {}) }}>
              <Gate />
            </View>
          </View>
        </AuthProvider>
      </PersistQueryClientProvider>
    </SafeAreaProvider>
  );
}

export default Sentry.wrap(RootLayout);

export { ErrorBoundary } from '@/components/ErrorBoundary';
