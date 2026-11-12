import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

export interface Picked { bytes: Uint8Array; width: number; height: number; uri: string }

function b64ToBytes(b64: string): Uint8Array {
  const bin = globalThis.atob ? globalThis.atob(b64) : '';
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Takes or chooses a photo and shrinks it to a JPEG under `maxBytes` (stepping down size and quality).
 * Returns null if the person cancels.
 */
export async function pickImage(o: { camera: boolean; maxBytes: number; maxSide: number; square?: boolean }): Promise<Picked | null> {
  if (o.camera) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('SplitIt needs camera access to take a photo. You can choose a photo instead.');
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsEditing: !!o.square, aspect: o.square ? [1, 1] : undefined };
  const res = o.camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  let side = o.maxSide;
  let quality = 0.8;
  for (let i = 0; i < 8; i++) {
    const big = Math.max(a.width || side, a.height || side);
    const scale = Math.min(1, side / big);
    const actions = scale < 1 && a.width && a.height ? [{ resize: { width: Math.round(a.width * scale), height: Math.round(a.height * scale) } }] : [];
    const out = await ImageManipulator.manipulateAsync(a.uri, actions, { compress: quality, format: ImageManipulator.SaveFormat.JPEG, base64: true });
    const bytes = b64ToBytes(out.base64 ?? '');
    if (bytes.length > 0 && bytes.length <= o.maxBytes) return { bytes, width: out.width, height: out.height, uri: out.uri };
    if (quality > 0.5) quality -= 0.15; else side = Math.round(side * 0.8);
  }
  throw new Error('That photo could not be made small enough. Try another one.');
}
