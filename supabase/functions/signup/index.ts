// Creates an account with name, email, Indian mobile number and password.
// Done on the server because Supabase's own phone sign-up needs a paid SMS provider.
import { admin } from '../_shared/clients.ts';
import { cors, json, UserError } from '../_shared/http.ts';
import { reportError } from '../_shared/sentry.ts';
import { isEmail, normalizeIndianPhone } from '../_shared/core/phone.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const b = await req.json().catch(() => ({}));
    const name = String(b.full_name ?? '').trim();
    const email = String(b.email ?? '').trim().toLowerCase();
    const phone = normalizeIndianPhone(String(b.phone ?? ''));
    const password = String(b.password ?? '');
    if (!name) throw new UserError('Please enter your name.');
    if (!isEmail(email)) throw new UserError('Please enter a valid email address.');
    if (!phone) throw new UserError('Please enter a 10-digit Indian mobile number.');
    if (password.length < 8) throw new UserError('Use a password of at least 8 characters.');

    const db = admin();
    const byEmail = await db.from('profiles').select('id').eq('email', email).limit(1);
    if (byEmail.data?.length) throw new UserError('An account with this email already exists. Try logging in.', 409);
    const byPhone = await db.from('profiles').select('id').eq('phone', phone).limit(1);
    if (byPhone.data?.length) throw new UserError('An account with this mobile number already exists. Try logging in.', 409);

    const { data, error } = await db.auth.admin.createUser({
      email, password, phone, email_confirm: true, phone_confirm: true,
      user_metadata: { full_name: name, phone },
    });
    if (error) {
      if (/already/i.test(error.message)) throw new UserError('An account with this email or mobile number already exists. Try logging in.', 409);
      throw error;
    }
    return json({ ok: true, user_id: data.user?.id });
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, e.status);
    await reportError(e, 'signup');
    return json({ error: 'Sign-up failed. Please try again in a minute.' }, 500);
  }
});
