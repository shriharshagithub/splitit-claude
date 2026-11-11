// Phone + password login. Supabase's phone provider needs an SMS service, so this looks up the
// account by phone and signs in with its email + password. Wrong phone and wrong password give the
// same message so the endpoint does not reveal which numbers have accounts.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { adminClient } from '../_shared/clients.ts';
import { cors, json, UserError } from '../_shared/http.ts';
import { captureException } from '../_shared/sentry.ts';

const BAD = 'That phone number or password is not right.';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (req.method !== 'POST') throw new UserError('Use POST.', 405);
    const body = await req.json().catch(() => ({}));
    const password = String(body.password ?? '');
    let d = String(body.phone ?? '').replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    if (!/^[6-9]\d{9}$/.test(d)) throw new UserError('Enter a 10-digit Indian mobile number.');
    if (!password) throw new UserError('Enter your password.');

    const { data: prof } = await adminClient().from('profiles').select('email').eq('phone', `+91${d}`).maybeSingle();
    if (!prof?.email) throw new UserError(BAD, 401);

    const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await anon.auth.signInWithPassword({ email: prof.email, password });
    if (error || !data.session) throw new UserError(BAD, 401);
    return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, e.status);
    await captureException(e, { function: 'login' });
    return json({ error: 'We could not log you in. Please try again.' }, 500);
  }
});
