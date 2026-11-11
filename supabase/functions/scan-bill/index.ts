// Receives a bill photo, validates it, stores it privately, and extracts line items with OCR.space.
// Any OCR failure still returns 200 with empty items so the app falls back to manual entry.
import { adminClient, userClient } from '../_shared/clients.ts';
import { cors, json, UserError } from '../_shared/http.ts';
import { captureException } from '../_shared/sentry.ts';
import { parseBillText } from '../_shared/core/billText.ts';

const MAX_BYTES = 10 * 1024 * 1024;
const OCR_FREE_LIMIT = 1024 * 1024; // OCR.space free tier rejects files over 1 MB

function sniff(b: Uint8Array): 'image/jpeg' | 'image/png' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function ocr(bytes: Uint8Array, mime: string): Promise<{ text: string | null; message?: string }> {
  const key = Deno.env.get('OCR_SPACE_API_KEY');
  if (!key) return { text: null, message: 'Automatic reading is not set up yet. Enter the items below.' };
  if (bytes.length > OCR_FREE_LIMIT) return { text: null, message: 'This photo is too large to read automatically. Enter the items below.' };
  const form = new FormData();
  form.append('base64Image', `data:${mime};base64,${toBase64(bytes)}`);
  form.append('OCREngine', '2');
  form.append('isTable', 'true');
  form.append('scale', 'true');
  form.append('detectOrientation', 'true');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch('https://api.ocr.space/parse/image', { method: 'POST', headers: { apikey: key }, body: form, signal: ctrl.signal });
    const out = await res.json();
    if (out?.IsErroredOnProcessing || !out?.ParsedResults?.length) {
      return { text: null, message: 'We could not read this bill. Enter the items below.' };
    }
    return { text: out.ParsedResults.map((r: { ParsedText?: string }) => r.ParsedText ?? '').join('\n') };
  } catch {
    return { text: null, message: 'Reading the bill took too long. Enter the items below.' };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (req.method !== 'POST') throw new UserError('Use POST.', 405);
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    const groupId = String(form?.get('group_id') ?? '');
    if (!(file instanceof File)) throw new UserError('Attach a photo of the bill.');
    if (!/^[0-9a-f-]{36}$/.test(groupId)) throw new UserError('Choose a group first.');
    if (file.size > MAX_BYTES) throw new UserError('The photo must be 10 MB or smaller.', 413);

    const user = userClient(req);
    const { data: member, error: memberErr } = await user.rpc('is_member', { g: groupId });
    if (memberErr || member !== true) throw new UserError('You are not a member of this group.', 403);

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new UserError('The photo must be 10 MB or smaller.', 413);
    const mime = sniff(bytes);
    if (!mime) throw new UserError('Upload a JPEG or PNG photo.', 415);

    const path = `${groupId}/${crypto.randomUUID()}.${mime === 'image/png' ? 'png' : 'jpg'}`;
    const { error: upErr } = await adminClient().storage.from('receipts').upload(path, bytes, { contentType: mime });
    if (upErr) throw upErr;

    const { text, message } = await ocr(bytes, mime);
    const parsed = text ? parseBillText(text) : null;
    const found = parsed && parsed.items.length > 0;
    return json({
      receipt_path: path,
      ocr_ok: Boolean(found),
      message: found ? null : (message ?? 'We could not find any items on this bill. Enter them below.'),
      items: parsed?.items ?? [],
      tax: parsed?.tax ?? 0,
      service_charge: parsed?.serviceCharge ?? 0,
      discount: parsed?.discount ?? 0,
      printed_total: parsed?.printedTotal ?? null,
    });
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, e.status);
    await captureException(e, { function: 'scan-bill' });
    return json({ error: 'Something went wrong while uploading the bill. Please try again.' }, 500);
  }
});
