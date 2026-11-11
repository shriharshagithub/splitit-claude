import { supabase, SUPABASE_KEY, SUPABASE_URL } from './supabase';
import { AppError, toAppError } from './errors';
import type {
  ActivityItem, ExpensePayload, ExpenseRow, GroupDetail, GroupSummary, GroupType, Notification, Profile, Settlement,
} from './types';

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw toAppError(error);
  return data as T;
}

async function callFunction<T>(name: string, body: unknown, opts: { auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { apikey: SUPABASE_KEY };
  if (!(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (opts.auth) {
    const { data } = await supabase.auth.getSession();
    if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers,
      body: body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch (e) {
    throw toAppError(e);
  }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new AppError(out.error ?? 'Something went wrong. Please try again.', res.status === 401 ? 'auth' : 'user');
  return out as T;
}

// ---------- auth ----------
export async function loginWithPhone(phone: string, password: string) {
  const s = await callFunction<{ access_token: string; refresh_token: string }>('login', { phone, password });
  const { error } = await supabase.auth.setSession(s);
  if (error) throw toAppError(error);
}

export async function loginWithEmail(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error) throw toAppError(error);
}

export async function signUp(input: { full_name: string; phone: string; email: string; password: string; invite_token?: string }) {
  await callFunction('signup', input);
  await loginWithEmail(input.email, input.password);
}

export async function sendPasswordReset(email: string, redirectTo: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo });
  if (error) {
    if (/rate limit/i.test(error.message)) throw new AppError('Too many reset emails were sent. Wait a few minutes and try again.');
    throw toAppError(error);
  }
}

export async function updatePassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new AppError(/should be different/i.test(error.message) ? 'Choose a password you have not used before.' : 'We could not change your password. Open the reset link again.');
}

// ---------- reads ----------
export async function getMyProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (error) throw toAppError(error);
  return data as Profile;
}

export const getMyGroups = () => rpc<GroupSummary[]>('my_groups');

export async function getGroup(id: string): Promise<GroupDetail> {
  const { data: g, error } = await supabase.from('groups').select('id, name, type, created_by').eq('id', id).maybeSingle();
  if (error) throw toAppError(error);
  if (!g) throw new AppError('This group does not exist or you are not a member.');
  const [{ data: members, error: mErr }, { data: invites, error: iErr }] = await Promise.all([
    supabase.from('group_members').select('user_id, role, profile:profiles(id, full_name, phone, email, upi_id, avatar_url)').eq('group_id', id),
    supabase.from('group_invites').select('id, contact, contact_kind, token, created_at').eq('group_id', id).is('accepted_at', null),
  ]);
  if (mErr || iErr) throw toAppError(mErr ?? iErr);
  const sorted = ((members ?? []) as unknown as GroupDetail['members']).sort((a, b) => a.profile.full_name.localeCompare(b.profile.full_name));
  return { ...(g as Omit<GroupDetail, 'members' | 'invites'>), members: sorted, invites: (invites ?? []) as GroupDetail['invites'] };
}

export async function getNets(groupId: string): Promise<Record<string, number>> {
  const rows = await rpc<{ user_id: string; net: number }[]>('group_nets', { g: groupId });
  return Object.fromEntries(rows.map((r) => [r.user_id, Number(r.net)]));
}

export const getExpensesPage = (groupId: string, before?: { date: string; created: string }) =>
  rpc<ExpenseRow[]>('group_expenses', { g: groupId, before_date: before?.date ?? null, before_created: before?.created ?? null, page_size: 30 });

export async function getExpense(id: string) {
  const { data, error } = await supabase.from('expenses')
    .select('*, splits:expense_splits(user_id, amount_owed), items:receipt_items(item_name, item_amount, assigned_user_ids)')
    .eq('id', id).maybeSingle();
  if (error) throw toAppError(error);
  if (!data) throw new AppError('This expense no longer exists.');
  return data as {
    id: string; group_id: string; paid_by: string; total_amount: number; description: string; category: string;
    expense_date: string; split_type: ExpensePayload['split_type']; split_inputs: ExpensePayload['inputs'];
    created_by: string; updated_at: string; receipt_url: string | null;
    splits: { user_id: string; amount_owed: number }[];
    items: { item_name: string; item_amount: number; assigned_user_ids: string[] }[];
  };
}

export async function getOpenSettlements(groupId: string): Promise<Settlement[]> {
  const { data, error } = await supabase.from('settlements').select('*').eq('group_id', groupId)
    .in('status', ['pending', 'marked_paid', 'declined']).order('created_at', { ascending: false }).limit(50);
  if (error) throw toAppError(error);
  return data as Settlement[];
}

export async function getNotifications(): Promise<Notification[]> {
  const { data, error } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(60);
  if (error) throw toAppError(error);
  return data as Notification[];
}

export async function getActivity(): Promise<ActivityItem[]> {
  const { data, error } = await supabase.from('activity').select('id, group_id, kind, summary, amount, created_at, groups(name)')
    .order('created_at', { ascending: false }).limit(80);
  if (error) throw toAppError(error);
  return (data ?? []).map((r) => ({ ...(r as unknown as ActivityItem), group_name: (r as unknown as { groups?: { name: string } }).groups?.name }));
}

export async function getSettlementStatuses(ids: string[]): Promise<Record<string, Settlement['status']>> {
  if (!ids.length) return {};
  const { data, error } = await supabase.from('settlements').select('id, status').in('id', ids);
  if (error) throw toAppError(error);
  return Object.fromEntries((data ?? []).map((r) => [r.id, r.status]));
}

export async function invitePreview(token: string) {
  const rows = await rpc<{ group_name: string; invited_by: string; accepted: boolean }[]>('invite_preview', { invite_token: token });
  return rows[0] ?? null;
}

// ---------- writes ----------
export type AddResult = { status: 'added' | 'invited' | 'already_member'; contact: string; name?: string; token?: string; kind?: 'phone' | 'email' };

export const createGroup = (name: string, type: GroupType, contacts: string[]) =>
  rpc<{ group_id: string; members: AddResult[] }>('create_group', { p_name: name, p_type: type, p_contacts: contacts });
export const addMember = (g: string, contact: string) => rpc<AddResult>('add_group_member', { g, contact });
export const removeMember = (g: string, member: string) => rpc<void>('remove_group_member', { g, member });
export const cancelInvite = (inviteId: string) => rpc<void>('cancel_invite', { invite_id: inviteId });
export const updateGroup = (g: string, name: string, type: GroupType) => rpc<void>('update_group', { g, p_name: name, p_type: type });
export const deleteGroup = (g: string) => rpc<void>('delete_group', { g });
export const acceptInvite = (token: string) => rpc<string>('accept_invite', { invite_token: token });
export const setMyPhone = (phone: string) => rpc<void>('set_my_phone', { p_phone: phone });

export const saveExpense = (p: ExpensePayload) =>
  rpc<{ id: string; updated_at: string; conflict: boolean; created: boolean }>('save_expense', { p });
export const deleteExpense = (id: string) => rpc<void>('delete_expense', { eid: id });

export const requestPayment = (g: string, debtor: string, amount: number) =>
  rpc<void>('request_payment', { g, debtor, p_amount: amount });
export const startSettlement = (g: string, to: string, amount: number, method: 'upi' | 'cash') =>
  rpc<{ id: string; upi_id: string | null; name: string }>('start_settlement', { g, p_to: to, p_amount: amount, p_method: method });
export const markPaid = (id: string, ref: string | null) => rpc<void>('mark_settlement_paid', { sid: id, ref });
export const respondSettlement = (id: string, accept: boolean) => rpc<void>('respond_settlement', { sid: id, accept });

export async function updateProfile(userId: string, patch: Partial<Pick<Profile, 'full_name' | 'upi_id' | 'avatar_url' | 'reminder_frequency'>>) {
  const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
  if (error) {
    if (error.code === '23514') throw new AppError('Check the UPI ID. It should look like name@bank.');
    throw toAppError(error);
  }
}

export async function markNotificationsRead(ids: string[]) {
  if (!ids.length) return;
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids);
}

export async function uploadAvatar(userId: string, uri: string, mime: string): Promise<string> {
  const body = await (await fetch(uri)).arrayBuffer();
  const path = `${userId}/avatar-${Date.now()}.${mime === 'image/png' ? 'png' : 'jpg'}`;
  const { error } = await supabase.storage.from('avatars').upload(path, body, { contentType: mime });
  if (error) throw new AppError(/size/i.test(error.message) ? 'The photo must be 2 MB or smaller.' : 'We could not upload the photo. Try again.');
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
}

export interface ScanResult {
  receipt_path: string;
  ocr_ok: boolean;
  message: string | null;
  items: { name: string; amount: number }[];
  tax: number;
  service_charge: number;
  discount: number;
  printed_total: number | null;
}

export async function scanBill(groupId: string, file: { uri: string; name: string; type: string } | Blob): Promise<ScanResult> {
  const form = new FormData();
  form.append('group_id', groupId);
  // React Native accepts {uri, name, type}; web needs a Blob.
  form.append('file', file as unknown as Blob, 'bill.jpg');
  return callFunction<ScanResult>('scan-bill', form, { auth: true });
}
