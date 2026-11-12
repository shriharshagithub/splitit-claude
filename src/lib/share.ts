import * as Clipboard from 'expo-clipboard';
import { Linking, Platform, Share } from 'react-native';
import { WEB_URL } from './config';

export const joinUrl = (code: string) => `${WEB_URL}/join/${code}`;

export function inviteMessage(groupName: string, code: string) {
  return `Hi! I've added you to "${groupName}" on SplitIt so we can split our expenses. Sign up with this number and you'll be in the group: ${joinUrl(code)}`;
}

/** wa.me link with the message filled in, addressed to the invited number (91XXXXXXXXXX). */
export function whatsAppUrl(phone: string, text: string) {
  return `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}

export async function openUrl(url: string) {
  if (Platform.OS === 'web') window.open(url, '_blank', 'noopener');
  else await Linking.openURL(url);
}

export async function copy(text: string) {
  await Clipboard.setStringAsync(text);
}

/** System share sheet where available, otherwise copy. Returns 'copied' when it fell back to copying. */
export async function shareText(text: string): Promise<'shared' | 'copied'> {
  if (Platform.OS === 'web') {
    const nav: any = typeof navigator !== 'undefined' ? navigator : null;
    if (nav?.share) {
      try { await nav.share({ text }); return 'shared'; } catch { /* cancelled */ }
    }
    await copy(text);
    return 'copied';
  }
  await Share.share({ message: text });
  return 'shared';
}
