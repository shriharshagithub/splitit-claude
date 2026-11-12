import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

/** Public web address of the app (GitHub Pages). Links in emails and invites point here. */
export const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL ?? 'https://shriharshagithub.github.io/splitit-claude').replace(/\/$/, '');

/** Where Supabase should send people back to after email links and Google sign-in. */
export function authRedirect(path: string): string {
  return Platform.OS === 'web' ? `${WEB_URL}${path}` : Linking.createURL(path);
}

export const inviteLink = (token: string) => `${WEB_URL}/invite/${token}`;
