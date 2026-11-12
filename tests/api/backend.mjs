// Live backend test: signs up real throwaway users and drives the API exactly as the app does.
// Proves the security rules (nobody reaches another group's data, only the payer can mark paid,
// only the receiver can confirm), the split arithmetic, the settlement flow, invites and live updates.
// Usage: node tests/api/backend.mjs        (test users use @example.com and are removed by scripts/clear-test-users.sql)
import { createClient } from '@supabase/supabase-js';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://ohawfftzgjuqwbilovmy.supabase.co';
const KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY || 'sb_publishable_PVlarZBValUdrAHKwkShMQ_jP52RpPq';
const run = Date.now().toString(36);
const results = [];
let failed = 0;
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail}` : ''}`);
}
const client = () => createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
async function fn(name, body, token) {
  const r = await fetch(`${URL}/functions/v1/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${token || KEY}` }, body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
function phone() { return '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'); }
async function user(label) {
  const email = `e2e-${run}-${label}@example.com`;
  const ph = phone();
  const s = await fn('signup', { full_name: `Test ${label}`, email, phone: ph, password: 'Passw0rd!' + run });
  if (s.status !== 200) throw new Error(`signup ${label}: ${JSON.stringify(s.body)}`);
  const c = client();
  const { data, error } = await c.auth.signInWithPassword({ email, password: 'Passw0rd!' + run });
  if (error) throw error;
  return { c, id: data.user.id, email, phone: ph, token: data.session.access_token };
}
const nets = async (c, gid) => Object.fromEntries(((await c.rpc('group_nets', { p_group: gid })).data ?? []).map((r) => [r.user_id, Number(r.net)]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const A = await user('a'), B = await user('b'), C = await user('c');
check('sign up with email + phone + password', A.id && B.id && C.id);

// Login paths
let r = await fn('login', { identifier: A.phone, password: 'Passw0rd!' + run });
check('log in with mobile number', r.status === 200 && r.body.session?.access_token, JSON.stringify(r.body));
r = await fn('login', { identifier: `+91 ${A.phone.slice(0, 5)} ${A.phone.slice(5)}`, password: 'Passw0rd!' + run });
check('log in with formatted mobile number (+91 98xxx xxxxx)', r.status === 200);
r = await fn('login', { identifier: A.phone, password: 'wrong-password' });
check('wrong password is refused with a plain message', r.status === 401 && /not right/.test(r.body.error));
r = await fn('signup', { full_name: 'Dup', email: A.email, phone: phone(), password: 'Passw0rd!x' });
check('duplicate email sign-up is refused', r.status === 409);
r = await fn('signup', { full_name: 'Dup', email: `dup-${run}@example.com`, phone: A.phone, password: 'Passw0rd!x' });
check('duplicate phone sign-up is refused', r.status === 409);
r = await fn('password-reset', { email: A.email });
check('password reset answers the same for any email', r.status === 200 && r.body.ok);

// Group + members
const { data: gid, error: ge } = await A.c.rpc('create_group', { p_name: `Goa ${run}`, p_type: 'trip' });
check('create group', gid && !ge, ge?.message);
r = await A.c.rpc('add_member', { p_group: gid, p_contact: B.phone });
check('add existing user by phone -> added', r.data?.status === 'added', JSON.stringify(r));
const inviteEmail = `e2e-${run}-d@example.com`;
r = await A.c.rpc('add_member', { p_group: gid, p_contact: inviteEmail });
check('add unknown email -> invite', r.data?.status === 'invited' && r.data.kind === 'email');
const invitePhone = phone();
r = await A.c.rpc('add_member', { p_group: gid, p_contact: invitePhone });
check('add unknown phone -> invite with token for WhatsApp', r.data?.status === 'invited' && r.data.kind === 'phone' && r.data.token);
r = await B.c.rpc('add_member', { p_group: gid, p_contact: C.phone });
check('a non-admin member cannot add people', !!r.error);
const { data: bNotes } = await B.c.from('notifications').select('type').eq('type', 'member_added');
check('existing user gets an "added to group" notification', bNotes?.length === 1);

// Outsider C: no reads, no writes
for (const t of ['groups', 'group_members', 'expenses', 'settlements', 'invites', 'activity']) {
  const q = t === 'groups' ? C.c.from(t).select('id, name') : C.c.from(t).select('*');
  const { data } = await q.eq(t === 'groups' ? 'id' : 'group_id', gid);
  check(`outsider sees nothing in ${t}`, Array.isArray(data) && data.length === 0);
}
const { data: aProfile } = await C.c.from('profiles').select('*').eq('id', A.id);
check("outsider cannot read a stranger's profile", aProfile?.length === 0);
r = await C.c.rpc('group_nets', { p_group: gid });
check('outsider cannot read balances', !!r.error);
r = await C.c.rpc('save_expense', { p_id: crypto.randomUUID(), p_group: gid, p_paid_by: C.id, p_total: 100, p_description: 'x', p_category: 'food', p_date: '2026-11-10', p_split_type: 'equal', p_members: [C.id], p_values: {} });
check('outsider cannot add an expense', !!r.error);
r = await C.c.from('expenses').insert({ group_id: gid, paid_by: C.id, total_amount: 100, description: 'x', expense_date: '2026-11-10', split_type: 'equal', created_by: C.id });
check('direct table insert is refused (writes only via checked functions)', !!r.error);
r = await A.c.from('groups').update({ name: 'hacked' }).eq('id', gid).select();
check('even members cannot update tables directly', !!r.error || r.data?.length === 0);
r = await A.c.from('notifications').insert({ user_id: B.id, type: 'reminder', title: 'fake', body: 'fake' });
check('nobody can forge a notification', !!r.error);
r = await C.c.rpc('group_invite_code', { p_group: gid });
check('outsider cannot read the invite code', !!r.error);
r = await C.c.from('groups').select('invite_code').eq('id', gid);
check('invite code column is not readable directly', !!r.error);
r = await C.c.storage.from('bills').upload(`${gid}/x.jpg`, new Uint8Array([0xff, 0xd8, 0xff, 0]), { contentType: 'image/jpeg' });
check("outsider cannot upload to the group's bills", !!r.error);

// Expenses: four split types, arithmetic from the database
const date = '2026-11-10';
const add = (c, o) => c.rpc('save_expense', { p_id: crypto.randomUUID(), p_group: gid, p_category: 'food', p_date: date, p_values: {}, ...o });
r = await add(A.c, { p_paid_by: A.id, p_total: 100000, p_description: 'Dinner', p_split_type: 'equal', p_members: [A.id, B.id] });
check('equal split saved', !r.error, r.error?.message);
r = await add(A.c, { p_paid_by: A.id, p_total: 1001, p_description: 'Chai', p_split_type: 'equal', p_members: [A.id, B.id] });
r = await add(B.c, { p_paid_by: B.id, p_total: 30000, p_description: 'Cab', p_split_type: 'exact', p_members: [A.id, B.id], p_values: { [A.id]: 10000, [B.id]: 20000 } });
check('exact split saved (by a member)', !r.error, r.error?.message);
r = await add(A.c, { p_paid_by: A.id, p_total: 30000, p_description: 'Bad', p_split_type: 'exact', p_members: [A.id, B.id], p_values: { [A.id]: 10000, [B.id]: 10000 } });
check('exact split that does not add up is rejected', !!r.error && /add up/.test(r.error.message), r.error?.message);
r = await add(A.c, { p_paid_by: A.id, p_total: 99999, p_description: 'Hotel', p_split_type: 'percentage', p_members: [A.id, B.id], p_values: { [A.id]: 6000, [B.id]: 4000 } });
check('percentage split saved', !r.error, r.error?.message);
r = await add(A.c, { p_paid_by: A.id, p_total: 90000, p_description: 'Boat', p_split_type: 'shares', p_members: [A.id, B.id], p_values: { [A.id]: 1, [B.id]: 2 } });
check('shares split saved', !r.error, r.error?.message);
const { data: exps } = await A.c.from('expenses').select('id, description, total_amount, expense_splits(user_id, amount_owed)').eq('group_id', gid);
const okSums = exps.every((e) => e.expense_splits.reduce((a, s) => a + Number(s.amount_owed), 0) === Number(e.total_amount));
check('every saved expense: splits add up to the total', okSums && exps.length === 5);
const chai = exps.find((e) => e.description === 'Chai');
check('leftover paisa goes to the payer (₹10.01 -> 501 / 500)', chai.expense_splits.find((s) => s.user_id === A.id).amount_owed == 501);
const hotel = exps.find((e) => e.description === 'Hotel');
check('percentage: 60% of ₹999.99 = ₹600.00 (payer gets leftover)', hotel.expense_splits.find((s) => s.user_id === A.id).amount_owed == 60000);
let n = await nets(A.c, gid);
// A paid 1000+10.01+999.99+900 = 2910.00; A owes 500+5.01+600+300+100 = 1505.01 -> +1404.99. B: paid 300, owes 500+5+399.99+600+200=1704.99 -> -1404.99
check('balances are correct to the paisa', n[A.id] === 140499 && n[B.id] === -140499, JSON.stringify(n));
r = await B.c.rpc('delete_expense', { p_id: exps.find((e) => e.description === 'Dinner').id });
check("a member cannot delete someone else's expense", !!r.error);
r = await B.c.rpc('save_expense', { p_id: exps.find((e) => e.description === 'Dinner').id, p_group: gid, p_paid_by: B.id, p_total: 5, p_description: 'x', p_category: 'food', p_date: date, p_split_type: 'equal', p_members: [B.id], p_values: {} });
check("a member cannot edit someone else's expense", !!r.error);

// Live updates: B listens; A adds an expense; B hears within a second. C cannot listen.
await B.c.realtime.setAuth(B.token);
await C.c.realtime.setAuth(C.token);
let heardAt = 0, cHeard = false, cStatus = '';
const chB = B.c.channel(`group:${gid}`, { config: { private: true } }).on('broadcast', { event: 'change' }, () => { heardAt ||= Date.now(); });
const chC = C.c.channel(`group:${gid}`, { config: { private: true } }).on('broadcast', { event: 'change' }, () => { cHeard = true; });
await new Promise((res) => chB.subscribe((s) => s === 'SUBSCRIBED' && res()));
chC.subscribe((s) => { cStatus = s; });
await sleep(1500);
const started = Date.now();
await add(A.c, { p_paid_by: A.id, p_total: 15000, p_description: 'Live test', p_split_type: 'equal', p_members: [A.id, B.id] });
const saved = Date.now();
for (let i = 0; i < 30 && !heardAt; i++) await sleep(50);
console.log(`      live update: save took ${saved - started} ms; heard ${heardAt - started} ms after tapping Save, ${Math.max(0, heardAt - saved)} ms after the save finished`);
check('live update reaches another member within 1 second of the save', heardAt && heardAt - saved < 1000, heardAt ? `${heardAt - saved} ms` : 'not heard');
await sleep(1000);
check("outsider cannot listen to the group's live updates", !cHeard, cStatus);
await B.c.removeAllChannels(); await C.c.removeAllChannels();

// Settlement: B owes A
n = await nets(A.c, gid);
const owed = -n[B.id];
const { data: sid } = await B.c.rpc('start_settlement', { p_group: gid, p_to: A.id, p_amount: owed, p_method: 'upi' });
check('payer starts a UPI settlement (pending)', !!sid);
r = await A.c.rpc('mark_settlement_paid', { p_id: sid, p_upi_ref: '1' });
check("receiver cannot mark someone else's payment as paid", !!r.error);
r = await C.c.rpc('mark_settlement_paid', { p_id: sid, p_upi_ref: '1' });
check("outsider cannot mark someone else's payment as paid", !!r.error);
r = await B.c.rpc('respond_settlement', { p_id: sid, p_confirm: true });
check('payer cannot confirm their own payment', !!r.error);
r = await B.c.rpc('mark_settlement_paid', { p_id: sid, p_upi_ref: '412345678901' });
check('payer marks paid with a UPI reference', !r.error, r.error?.message);
n = await nets(A.c, gid);
check('marking paid does NOT clear the debt', n[B.id] === -owed);
const { data: aNote } = await A.c.from('notifications').select('type, body').eq('type', 'payment_marked');
check('receiver gets an in-app "marked as paid" message with the reference', aNote?.length === 1 && aNote[0].body.includes('412345678901'));
r = await C.c.rpc('respond_settlement', { p_id: sid, p_confirm: true });
check('outsider cannot confirm a payment sent to someone else', !!r.error);
r = await A.c.rpc('respond_settlement', { p_id: sid, p_confirm: false });
check('receiver declines', !r.error);
n = await nets(A.c, gid);
check('declined payment leaves the debt intact', n[B.id] === -owed);
const { data: sid2 } = await B.c.rpc('start_settlement', { p_group: gid, p_to: A.id, p_amount: owed, p_method: 'cash' });
check('payer can retry (cash this time)', !!sid2 && sid2 !== sid);
await B.c.rpc('mark_settlement_paid', { p_id: sid2 });
r = await A.c.rpc('respond_settlement', { p_id: sid2, p_confirm: true });
check('receiver confirms the cash payment', !r.error, r.error?.message);
n = await nets(A.c, gid);
check('only the confirmation clears the debt', n[B.id] === 0 && n[A.id] === 0, JSON.stringify(n));
const { data: bConf } = await B.c.from('notifications').select('type').in('type', ['payment_confirmed', 'payment_declined']);
check('payer is told about the decline and the confirmation', bConf?.length === 2);

// Invite link + invites claimed on sign-up
const { data: code } = await A.c.rpc('group_invite_code', { p_group: gid });
r = await client().rpc('invite_preview', { p_code: code });
check('logged-out visitor sees only the group name from an invite link', r.data?.name === `Goa ${run}` && !r.data.invite_code);
r = await C.c.rpc('join_group', { p_code: code });
check('joining with the invite link works', r.data === gid);
const { data: newCode } = await A.c.rpc('reset_invite_code', { p_group: gid });
r = await C.c.rpc('reset_invite_code', { p_group: gid });
check('only the admin can reset the invite link', !!r.error);
r = await B.c.rpc('join_group', { p_code: code });
check('old link stops working after a reset', !!r.error && newCode !== code);
const s = await fn('signup', { full_name: 'Test d', email: inviteEmail, phone: phone(), password: 'Passw0rd!' + run });
const D = client();
await D.auth.signInWithPassword({ email: inviteEmail, password: 'Passw0rd!' + run });
const { data: dGroups } = await D.rpc('my_groups');
check('signing up with an invited email joins the group automatically', s.status === 200 && dGroups?.some((g) => g.id === gid));

// Admin-only actions
r = await B.c.rpc('update_group', { p_group: gid, p_name: 'x', p_type: 'trip' });
check('only the admin can rename the group', !!r.error);
r = await B.c.rpc('delete_group', { p_group: gid });
check('only the admin can delete the group', !!r.error);
r = await client().rpc('my_groups');
check('logged-out calls get nothing', !!r.error || (r.data ?? []).length === 0);

console.log(`\n${results.length - failed}/${results.length} checks passed (run ${run})`);
process.exit(failed ? 1 : 0);
