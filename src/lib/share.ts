import * as Clipboard from 'expo-clipboard';
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
