// Reads a bill photo the app has uploaded to the private "bills" bucket.
// Checks membership, file type (by its first bytes) and size, then asks OCR.space for the text
// and parses items, tax, service charge, discount and total. Any failure returns ok:false so the
// app opens the same screen empty for manual entry.
import { admin, asUser } from '../_shared/clients.ts';
import { cors, json } from '../_shared/http.ts';
import { reportError } from '../_shared/sentry.ts';
import { parseBillText } from '../_shared/core/billText.ts';

const MAX = 10 * 1024 * 1024;
const OCR_LIMIT = 1024 * 1024; // OCR.space free tier

function kind(b: Uint8Array): 'jpeg' | 'png' | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  return null;
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  let path = '';
  try {
    const user = asUser(req);
    const { data: auth } = await user.auth.getUser();
    if (!auth?.user) return json({ ok: false, reason: 'Please log in again.' }, 401);
    const b = await req.json().catch(() => ({}));
    path = String(b.path ?? '');
    const groupId = path.split('/')[0];
    const { data: member } = await user.rpc('is_member', { gid: groupId });
    if (member !== true) return json({ ok: false, reason: 'You are not in this group.' }, 403);

    const { data: file, error } = await admin().storage.from('bills').download(path);
    if (error || !file) return json({ ok: false, reason: 'Could not find the uploaded photo.' }, 404);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > MAX) return json({ ok: false, reason: 'That photo is over 10 MB.' }, 413);
    const k = kind(bytes);
    if (!k) {
      await admin().storage.from('bills').remove([path]);
      return json({ ok: false, reason: 'Only JPEG or PNG photos can be read.' }, 415);
    }
    if (bytes.length > OCR_LIMIT) return json({ ok: false, reason: 'The photo is too large to read automatically. Enter the items by hand.' });

    const form = new FormData();
    form.append('base64Image', `data:image/${k};base64,${b64(bytes)}`);
    form.append('language', 'eng');
    form.append('isTable', 'true');
    form.append('scale', 'true');
    form.append('OCREngine', '2');
    const r = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST', headers: { apikey: Deno.env.get('OCR_SPACE_API_KEY') || 'helloworld' }, body: form,
      signal: AbortSignal.timeout(25000),
    });
    const out = await r.json().catch(() => null);
    const text: string = out?.ParsedResults?.map((p: { ParsedText?: string }) => p.ParsedText ?? '').join('\n') ?? '';
    if (!r.ok || out?.IsErroredOnProcessing || !text.trim()) {
      console.warn('ocr failed', r.status, JSON.stringify(out)?.slice(0, 500));
      return json({ ok: false, reason: 'We could not read this bill. Enter the items by hand.' });
    }
    const bill = parseBillText(text);
    if (bill.items.length === 0) return json({ ok: false, reason: 'We could not find any items on this bill. Enter them by hand.', text });
    return json({ ok: true, ...bill, receipt_path: path });
  } catch (e) {
    await reportError(e, 'scan-bill', { path });
    return json({ ok: false, reason: 'We could not read this bill. Enter the items by hand.' });
  }
});
