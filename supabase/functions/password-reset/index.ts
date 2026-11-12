// Emails a single-use, time-limited password reset link (Supabase recovery token) through Resend.
// Always answers the same way so nobody can find out which emails have accounts.
import { admin } from '../_shared/clients.ts';
import { appUrl, cors, json } from '../_shared/http.ts';
import { renderEmail, sendEmail } from '../_shared/email.ts';
import { reportError } from '../_shared/sentry.ts';
import { isEmail } from '../_shared/core/phone.ts';

const DONE = { ok: true, message: 'If that email has a SplitIt account, a reset link is on its way. It works once and expires in 1 hour.' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const b = await req.json().catch(() => ({}));
    const email = String(b.email ?? '').trim().toLowerCase();
    if (!isEmail(email)) return json({ error: 'Please enter a valid email address.' }, 400);
    const { data, error } = await admin().auth.admin.generateLink({ type: 'recovery', email });
    if (error || !data?.properties?.hashed_token) return json(DONE); // unknown email: same answer
    const link = `${appUrl()}/reset-password?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery`;
    const sent = await sendEmail(email, 'Reset your SplitIt password', renderEmail({
      heading: 'Reset your password',
      lines: ['Tap the button to choose a new SplitIt password.', 'The link works once and expires in 1 hour. If you did not ask for this, you can ignore this email.'],
      button: { label: 'Choose a new password', url: link },
      footer: 'You got this email because someone asked to reset the password for this address on SplitIt.',
    }));
    if (!sent.ok) await reportError(new Error(sent.error), 'password-reset');
    return json(DONE);
  } catch (e) {
    await reportError(e, 'password-reset');
    return json({ error: 'Could not send the email. Please try again in a minute.' }, 500);
  }
});
