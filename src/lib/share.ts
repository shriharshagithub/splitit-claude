import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { Platform, Share } from 'react-native';

/** Opens the share sheet (WhatsApp, SMS…). Falls back to copying on browsers without one. Returns what happened. */
export async function shareText(message: string): Promise<'shared' | 'copied'> {
  if (Platform.OS === 'web') {
    const nav = globalThis.navigator as Navigator & { share?: (d: { text: string }) => Promise<void> };
    if (nav?.share) {
      try {
        await nav.share({ text: message });
        return 'shared';
      } catch {
        /* fall through to copy */
      }
    }
    await Clipboard.setStringAsync(message);
    return 'copied';
  }
  await Share.share({ message });
  return 'shared';
}

/** wa.me link that opens a chat with this Indian number, message filled in. Works in the app and in browsers (WhatsApp Web on computers). */
export function whatsappLink(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, '').replace(/^0+/, '');
  const number = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

export async function openWhatsApp(phone: string, message: string): Promise<void> {
  const url = whatsappLink(phone, message);
  if (Platform.OS === 'web') {
    // A pop-up blocker can stop a new tab opened after a network call; then go there directly.
    // ('noopener' is not passed because it makes open() return null even when the tab opened.)
    const tab = globalThis.open?.(url, '_blank');
    if (tab) tab.opener = null;
    else globalThis.location.href = url;
    return;
  }
  await Linking.openURL(url);
}
