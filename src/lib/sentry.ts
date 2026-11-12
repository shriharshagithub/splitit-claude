import * as Sentry from '@sentry/react-native';
import { SENTRY_DSN } from './config';

export const sentryOn = !!SENTRY_DSN;
if (sentryOn) {
  Sentry.init({ dsn: SENTRY_DSN, tracesSampleRate: 0, enableAutoSessionTracking: true });
}

export function report(e: unknown, screen?: string) {
  if (sentryOn) Sentry.captureException(e, { tags: { screen: screen ?? 'unknown' } });
  else console.error(e);
}
export { Sentry };
