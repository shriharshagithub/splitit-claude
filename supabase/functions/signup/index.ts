// Creates an account with phone + email + password. Phone is the login identifier;
// it is not verified by OTP (no SMS provider). Email is used for password reset and notifications.
import { adminClient } from '../_shared/clients.ts';
import { cors, json, UserError } from '../_shared/http.ts';
import { captureException } from '../_shared/sentry.ts';

function normalizePhone(raw: string): string | null {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (req.method !== 'POST') throw new UserError('Use POST.', 405);
    const body = await req.json().catch(() => ({}));
    const fullName = String(body.full_name ?? '').trim();
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const phone = normalizePhone(body.phone);
    const inviteToken = typeof body.invite_token === 'string' && /^[0-9a-f]{36}$/.test(body.invite_token) ? body.invite_token : undefined;

    if (fullName.length < 1 || fullName.length > 80) throw new UserError('Enter your name.');
    if (!phone) throw new UserError('Enter a 10-digit Indian mobile number.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) throw new UserError('Enter a valid email address.');
    if (password.length < 8 || password.length > 72) throw new UserError('Use a password of at least 8 characters.');

    const admin = adminClient();
    const { data: clash } = await admin.from('profiles').select('phone, email').or(`phone.eq.${phone},email.eq.${email}`);
    if (clash?.some((r) => r.phone === phone)) throw new UserError('That phone number already has an account. Log in instead.', 409);
    if (clash?.some((r) => r.email === email)) throw new UserError('That email already has an account. Log in instead.', 409);

    const { error } = await admin.auth.admin.createUser({
      email,
      phone: phone.slice(1),
      password,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { full_name: fullName, ...(inviteToken ? { invite_token: inviteToken } : {}) },
    });
    if (error) {
      if (/already/i.test(error.message)) throw new UserError('An account with these details already exists. Log in instead.', 409);
      throw error;
    }
    return json({ ok: true, phone });
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, e.status);
    await captureException(e, { function: 'signup' });
    return json({ error: 'We could not create your account. Please try again.' }, 500);
  }
});
