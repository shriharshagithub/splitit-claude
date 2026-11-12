import * as Sentry from '@sentry/react-native';
import type { ErrorBoundaryProps } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { Button, T } from './ui';
import { space, useColors } from '@/theme';

/** Shown instead of a crashed screen. Reports to Sentry; never shows the stack trace. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const c = useColors();
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <View style={{ flex: 1, backgroundColor: c.ground, padding: space[6], justifyContent: 'center', gap: space[4] }}>
      <T v="title">This screen hit a problem</T>
      <T color="muted">We have been told about it. Try again, or go back to your groups.</T>
      <Button label="Try again" onPress={retry} />
    </View>
  );
}
