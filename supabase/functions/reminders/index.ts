// Daily at 09:00 IST (pg_cron -> pg_net -> here).
// 1. Reminds anyone who has owed money in a group for more than 3 days (daily, weekly or off, per person).
// 2. Nudges, once, anyone who has not confirmed or declined a payment claim within 3 days.
// Every reminder is a notification, which the database also emails.
import { admin, checkHookSecret } from '../_shared/clients.ts';
import { cors, json } from '../_shared/http.ts';
import { reportError } from '../_shared/sentry.ts';
import { simplifyDebts } from '../_shared/core/simplify.ts';
import { formatINR } from '../_shared/core/money.ts';

const DAY = 86_400_000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!(await checkHookSecret(req))) return json({ error: 'forbidden' }, 403);
  try {
    const db = admin();
    const now = Date.now();
    const { data: rows, error } = await db.rpc('reminder_candidates');
    if (error) throw error;

    type Row = { group_id: string; group_name: string; user_id: string; net: number; oldest_debt: string | null };
    const groups = new Map<string, { name: string; rows: Row[] }>();
    for (const r of (rows ?? []) as Row[]) {
      if (!groups.has(r.group_id)) groups.set(r.group_id, { name: r.group_name, rows: [] });
      groups.get(r.group_id)!.rows.push(r);
    }
    const userIds = [...new Set(((rows ?? []) as Row[]).map((r) => r.user_id))];
    const { data: profiles } = await db.from('profiles').select('id, full_name, reminder_freq').in('id', userIds.length ? userIds : ['00000000-0000-0000-0000-000000000000']);
    const prof = new Map((profiles ?? []).map((p) => [p.id, p]));

    let reminded = 0, skipped = 0;
    for (const [gid, g] of groups) {
      const nets: Record<string, number> = {};
      const oldest: Record<string, string | null> = {};
      for (const r of g.rows) { nets[r.user_id] = Number(r.net); oldest[r.user_id] = r.oldest_debt; }
      for (const t of simplifyDebts(nets)) {
        const debtor = prof.get(t.from);
        const since = oldest[t.from] ? Date.parse(oldest[t.from]!) : now;
        if (!debtor || debtor.reminder_freq === 'off' || now - since < 3 * DAY) { skipped++; continue; }
        const gap = debtor.reminder_freq === 'weekly' ? 6.5 * DAY : 0.75 * DAY;
        const { data: last } = await db.from('reminders').select('sent_at').eq('group_id', gid).eq('debtor_user_id', t.from)
          .eq('status', 'sent').order('sent_at', { ascending: false }).limit(1).maybeSingle();
        if (last?.sent_at && now - Date.parse(last.sent_at) < gap) { skipped++; continue; }
        const creditor = prof.get(t.to)?.full_name || 'Your friend';
        await db.from('reminders').insert({ group_id: gid, debtor_user_id: t.from, creditor_user_id: t.to, amount: t.amount, sent_at: new Date().toISOString(), status: 'sent' });
        await db.from('notifications').insert({
          user_id: t.from, group_id: gid, type: 'reminder',
          title: `Reminder: you owe ${creditor} ${formatINR(t.amount)}`,
          body: `You owe ${creditor} ${formatINR(t.amount)} for ${g.name}. Pay over UPI or in cash from SplitIt.`,
          payload: { group_id: gid, to_user: t.to, amount: t.amount },
        });
        await db.from('activity').insert({ group_id: gid, actor: null, kind: 'reminder_sent', summary: `Reminder sent to ${debtor.full_name} for ${formatINR(t.amount)} owed to ${creditor}` });
        reminded++;
      }
    }

    // Unanswered payment claims
    const { data: stale } = await db.from('settlements').select('id, group_id, from_user, to_user, amount, method, upi_ref')
      .eq('status', 'marked_paid').is('nudged_at', null).lt('marked_paid_at', new Date(now - 3 * DAY).toISOString());
    let nudged = 0;
    for (const s of stale ?? []) {
      const [{ data: payer }, { data: grp }] = await Promise.all([
        db.from('profiles').select('full_name').eq('id', s.from_user).single(),
        db.from('groups').select('name').eq('id', s.group_id).single(),
      ]);
      await db.from('notifications').insert({
        user_id: s.to_user, group_id: s.group_id, type: 'confirm_nudge',
        title: `Did ${payer?.full_name ?? 'your friend'} pay you ${formatINR(s.amount)}?`,
        body: `${payer?.full_name ?? 'Your friend'} said they paid you ${formatINR(s.amount)} ${s.method === 'cash' ? 'in cash' : 'via UPI'} for ${grp?.name} 3 days ago.${s.upi_ref ? ` Ref: ${s.upi_ref}.` : ''} Please confirm or decline so the balance is right.`,
        payload: { group_id: s.group_id, settlement_id: s.id, amount: s.amount },
      });
      await db.from('settlements').update({ nudged_at: new Date().toISOString() }).eq('id', s.id);
      nudged++;
    }
    console.log(JSON.stringify({ reminded, skipped, nudged }));
    return json({ reminded, skipped, nudged });
  } catch (e) {
    await reportError(e, 'reminders');
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
