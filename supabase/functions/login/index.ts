// Log in with email or Indian mobile number + password. Returns a normal Supabase session.
import { admin, anon } from '../_shared/clients.ts';
import { cors, json, UserError } from '../_shared/http.ts';
import { reportError } from '../_shared/sentry.ts';
import { normalizeIndianPhone } from '../_shared/core/phone.ts';

const WRONG = 'That login or password is not right.';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const b = await req.json().catch(() => ({}));
    const id = String(b.identifier ?? '').trim();
    const password = String(b.password ?? '');
    if (!id || !password) throw new UserError('Enter your email or mobile number and your password.');
    let email = id.toLowerCase();
    if (!id.includes('@')) {
      const phone = normalizeIndianPhone(id);
      if (!phone) throw new UserError('Enter a valid email or 10-digit mobile number.');
      const { data } = await admin().from('profiles').select('email').eq('phone', phone).maybeSingle();
      if (!data?.email) throw new UserError(WRONG, 401);
      email = data.email;
    }
    const { data, error } = await anon().auth.signInWithPassword({ email, password });
    if (error || !data.session) throw new UserError(WRONG, 401);
    return json({ session: data.session });
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, e.status);
    await reportError(e, 'login');
    return json({ error: 'Login failed. Please try again in a minute.' }, 500);
  }
});
