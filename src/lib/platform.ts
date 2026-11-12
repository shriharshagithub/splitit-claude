import { Platform } from 'react-native';

/** True on Android phones, both in the app and in Android browsers. */
export function isAndroid(): boolean {
  if (Platform.OS === 'android') return true;
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') return /Android/i.test(navigator.userAgent);
  return false;
}

import { router, type Href } from 'expo-router';

/** Go back if there is somewhere to go back to (e.g. opened from a link in an email), otherwise go to `fallback`. */
export function backOr(fallback: Href) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
