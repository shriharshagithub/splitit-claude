// Called by database triggers (with the Vault hook secret) when a notification or an email invite is created.
import { adminClient, verifyHook } from '../_shared/clients.ts';
import { appLink, renderEmail, sendEmail } from '../_shared/email.ts';
import { json } from '../_shared/http.ts';
import { captureException } from '../_shared/sentry.ts';

Deno.serve(async (req) => {
  try {
    if (!(await verifyHook(req))) return json({ error: 'forbidden' }, 403);
    const body = await req.json().catch(() => ({}));
    const db = adminClient();

    if (body.invite_id) {
      const { data: inv } = await db.from('group_invites')
        .select('contact, contact_kind, token, accepted_at, groups(name), inviter:profiles!group_invites_invited_by_fkey(full_name)')
        .eq('id', body.invite_id).single();
      if (!inv || inv.contact_kind !== 'email' || inv.accepted_at) return json({ skipped: true });
      // deno-lint-ignore no-explicit-any
      const group = (inv as any).groups?.name ?? 'a group';
      // deno-lint-ignore no-explicit-any
      const inviter = String((inv as any).inviter?.full_name ?? 'A friend').split(' ')[0];
      const err = await sendEmail(inv.contact, `${inviter} invited you to ${group} on SplitIt`, renderEmail({
        heading: `Join ${group} on SplitIt`,
        body: `${inviter} added you to ${group} to split expenses. Create your SplitIt account to see what you owe and settle up over UPI.`,
        button: { label: 'Accept invite', url: appLink(`/invite/${inv.token}`) },
      }));
      return json({ sent: !err, reason: err });
    }

    const { data: n } = await db.from('notifications')
      .select('id, type, title, body, payload, group_id, emailed_at, user:profiles!notifications_user_id_fkey(email, full_name)')
      .eq('id', body.notification_id).single();
    if (!n || n.emailed_at) return json({ skipped: true });
    // deno-lint-ignore no-explicit-any
    const email = (n as any).user?.email as string | undefined;
    if (!email) return json({ skipped: 'no email' });

    const p = (n.payload ?? {}) as Record<string, string>;
    let button: { label: string; url: string } | undefined;
    switch (n.type) {
      case 'payment_request':
      case 'reminder':
        button = { label: 'Pay via UPI', url: appLink(`/group/${n.group_id}/settle/${p.creditor}`) };
        break;
      case 'payment_marked':
      case 'confirm_nudge':
        button = { label: 'Confirm or decline', url: appLink('/activity') };
        break;
      default:
        button = { label: 'Open SplitIt', url: appLink(`/group/${n.group_id}`) };
    }
    const err = await sendEmail(email, n.title, renderEmail({ heading: n.title, body: n.body, button }));
    if (!err) await db.from('notifications').update({ emailed_at: new Date().toISOString() }).eq('id', n.id);
    return json({ sent: !err, reason: err });
  } catch (e) {
    await captureException(e, { function: 'notify-email' });
    return json({ error: 'failed' }, 500);
  }
});
