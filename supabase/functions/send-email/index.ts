// Called by the database (pg_net) whenever a notification or an email invite is created.
import { admin, checkHookSecret } from '../_shared/clients.ts';
import { appUrl, cors, json } from '../_shared/http.ts';
import { renderEmail, sendEmail } from '../_shared/email.ts';
import { reportError } from '../_shared/sentry.ts';
import { formatINR } from '../_shared/core/money.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!(await checkHookSecret(req))) return json({ error: 'forbidden' }, 403);
  const b = await req.json().catch(() => ({}));
  try {
    const db = admin();
    const app = appUrl();
    if (b.kind === 'invite') {
      const { data: inv } = await db.from('invites').select('email, token, accepted_at, group_id, invited_by').eq('id', b.id).maybeSingle();
      if (!inv?.email || inv.accepted_at) return json({ skipped: 'no pending email invite' });
      const [{ data: g }, { data: who }] = await Promise.all([
        db.from('groups').select('name').eq('id', inv.group_id).single(),
        db.from('profiles').select('full_name').eq('id', inv.invited_by).single(),
      ]);
      const r = await sendEmail(inv.email, `${who?.full_name ?? 'A friend'} invited you to ${g?.name} on SplitIt`, renderEmail({
        heading: `Join "${g?.name}" on SplitIt`,
        lines: [`${who?.full_name ?? 'A friend'} is using SplitIt to share expenses in "${g?.name}" and added you.`,
          'Sign up with this email address and you will be in the group straight away.'],
        button: { label: 'Join the group', url: `${app}/join/${inv.token}` },
        footer: 'You got this email because a friend added this address to a group on SplitIt.',
      }));
      if (!r.ok) throw new Error(r.error);
      return json({ sent: r.id });
    }

    if (b.kind === 'notification') {
      const { data: n } = await db.from('notifications').select('*').eq('id', b.id).maybeSingle();
      if (!n) return json({ skipped: 'not found' });
      const { data: user } = await db.from('profiles').select('email, full_name').eq('id', n.user_id).single();
      if (!user?.email) return json({ skipped: 'no email' });
      const p = n.payload ?? {};
      let button: { label: string; url: string } | undefined;
      switch (n.type) {
        case 'payment_request':
        case 'reminder':
          button = { label: `Pay ${formatINR(Number(p.amount))}`, url: `${app}/group/${n.group_id}/settle?to=${p.to_user}&amount=${p.amount}` };
          break;
        case 'payment_marked':
        case 'confirm_nudge':
          button = { label: 'Confirm or decline', url: `${app}/activity` };
          break;
        default:
          button = n.group_id ? { label: 'Open the group', url: `${app}/group/${n.group_id}` } : undefined;
      }
      const r = await sendEmail(user.email, n.title, renderEmail({ heading: n.title, lines: [`Hi ${user.full_name || 'there'},`, n.body], button }));
      if (!r.ok) throw new Error(r.error);
      return json({ sent: r.id });
    }
    return json({ error: 'unknown kind' }, 400);
  } catch (e) {
    await reportError(e, 'send-email', { kind: b.kind, id: b.id });
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
