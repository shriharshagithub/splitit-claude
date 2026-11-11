// Daily job (pg_cron, 09:00 IST). For each simplified debt whose debtor has owed money for more
// than 3 days, sends one reminder per the debtor's preference (daily / weekly / off). Settled debts
// drop out of the balance set, so their reminders stop on their own. Also nudges receivers who have
// left a payment claim unanswered for 3 days.
import { adminClient, verifyHook } from '../_shared/clients.ts';
import { json } from '../_shared/http.ts';
import { captureException } from '../_shared/sentry.ts';
import { simplifyDebts } from '../_shared/core/simplify.ts';

const DAY = 24 * 3600 * 1000;
const GAP = { daily: 20 * 3600 * 1000, weekly: 6 * DAY + 20 * 3600 * 1000 } as const;

interface Row {
  group_id: string; group_name: string; user_id: string; full_name: string; net: number;
  debt_since: string | null; frequency: 'daily' | 'weekly' | 'off'; last_reminded: string | null;
}

Deno.serve(async (req) => {
  try {
    if (!(await verifyHook(req))) return json({ error: 'forbidden' }, 403);
    const db = adminClient();
    const now = Date.now();
    const { data, error } = await db.rpc('_reminder_inputs');
    if (error) throw error;

    const byGroup = new Map<string, Row[]>();
    for (const r of (data ?? []) as Row[]) byGroup.set(r.group_id, [...(byGroup.get(r.group_id) ?? []), r]);

    const sent: { group: string; debtor: string; creditor: string; amount: number }[] = [];
    const skipped: Record<string, number> = { too_recent_debt: 0, preference_off: 0, reminded_recently: 0 };
    for (const [groupId, rows] of byGroup) {
      const nets = Object.fromEntries(rows.map((r) => [r.user_id, Number(r.net)]));
      const info = new Map(rows.map((r) => [r.user_id, r]));
      for (const t of simplifyDebts(nets)) {
        const d = info.get(t.from)!;
        if (!d.debt_since || now - Date.parse(d.debt_since) < 3 * DAY) { skipped.too_recent_debt++; continue; }
        if (d.frequency === 'off') { skipped.preference_off++; continue; }
        if (d.last_reminded && now - Date.parse(d.last_reminded) < GAP[d.frequency]) { skipped.reminded_recently++; continue; }
        const { error: e } = await db.rpc('_send_reminder', { g: groupId, debtor: t.from, creditor: t.to, amt: t.amount });
        if (e) throw e;
        sent.push({ group: d.group_name, debtor: d.full_name, creditor: info.get(t.to)?.full_name ?? '', amount: t.amount });
      }
    }
    const { data: nudged, error: nErr } = await db.rpc('_nudge_unconfirmed');
    if (nErr) throw nErr;
    return json({ ran_at: new Date(now).toISOString(), reminders_sent: sent.length, sent, skipped, confirm_nudges: nudged });
  } catch (e) {
    await captureException(e, { function: 'reminders' });
    return json({ error: 'failed' }, 500);
  }
});
