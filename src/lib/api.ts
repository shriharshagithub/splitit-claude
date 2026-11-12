import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { computeSplits } from '@/core';
import { useUserId } from './auth';
import { usePendingOps, outbox } from './outboxInstance';
import type { SaveExpenseArgs } from './outbox';
import { supabase } from './supabase';
import type { ActivityRow, Expense, GroupInfo, GroupSummary, Invite, Notification, Profile, Settlement } from './types';

const PROFILE_COLS = 'id, full_name, phone, email, upi_id, avatar_url';
export const PAGE = 30;

async function unwrap<T>(p: PromiseLike<{ data: any; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

export const keys = {
  myGroups: ['myGroups'] as const,
  group: (id: string) => ['group', id] as const,
  info: (id: string) => ['group', id, 'info'] as const,
  expenses: (id: string) => ['group', id, 'expenses'] as const,
  nets: (id: string) => ['group', id, 'nets'] as const,
  settlements: (id: string) => ['group', id, 'settlements'] as const,
  invites: (id: string) => ['group', id, 'invites'] as const,
  notifications: ['notifications'] as const,
  activity: ['activity'] as const,
  me: ['me'] as const,
};

export function useMe() {
  const uid = useUserId();
  return useQuery({
    queryKey: keys.me, enabled: !!uid,
    queryFn: () => unwrap<Profile>(supabase.from('profiles').select(`${PROFILE_COLS}, reminder_freq`).eq('id', uid).single()),
  });
}

export function useMyGroups() {
  return useQuery({ queryKey: keys.myGroups, queryFn: () => unwrap<GroupSummary[]>(supabase.rpc('my_groups')) });
}

export function useGroupInfo(id: string, opts: { fresh?: boolean } = {}) {
  return useQuery({
    queryKey: keys.info(id), enabled: !!id, refetchOnMount: opts.fresh ? 'always' : true,
    queryFn: async (): Promise<GroupInfo> => {
      const g = await unwrap<any>(supabase.from('groups').select(`id, name, type, created_by, group_members(user_id, role, profile:profiles(${PROFILE_COLS}))`).eq('id', id).maybeSingle());
      if (!g) throw new Error("This group doesn't exist, or you are not in it.");
      const members = (g.group_members as any[]).map((m) => ({ user_id: m.user_id, role: m.role, profile: m.profile }))
        .sort((a, b) => (a.role === b.role ? a.profile.full_name.localeCompare(b.profile.full_name) : a.role === 'admin' ? -1 : 1));
      return { id: g.id, name: g.name, type: g.type, created_by: g.created_by, members };
    },
  });
}

export function useExpenses(id: string) {
  return useInfiniteQuery({
    queryKey: keys.expenses(id), enabled: !!id, initialPageParam: 0,
    queryFn: ({ pageParam }) => unwrap<Expense[]>(supabase.from('expenses')
      .select('*, expense_splits(user_id, amount_owed)').eq('group_id', id)
      .order('expense_date', { ascending: false }).order('created_at', { ascending: false })
      .range(pageParam, pageParam + PAGE - 1)),
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
  });
}

/** Expenses saved on this phone but not yet synced, shaped like server rows. */
export function usePendingExpenses(groupId: string): { saves: Expense[]; deletes: Set<string> } {
  const ops = usePendingOps();
  const saves: Expense[] = [];
  const deletes = new Set<string>();
  for (const o of ops) {
    if (o.groupId !== groupId) continue;
    if (o.kind === 'delete') { deletes.add(o.args.p_id); continue; }
    const a = o.args;
    const r = computeSplits({ total: a.p_total, payer: a.p_paid_by, type: a.p_split_type as any, members: a.p_members, values: a.p_values });
    saves.push({
      id: a.p_id, group_id: a.p_group, paid_by: a.p_paid_by, total_amount: a.p_total, description: a.p_description, category: a.p_category,
      expense_date: a.p_date, split_type: a.p_split_type as any, split_values: a.p_values, receipt_url: a.p_receipt_url ?? null,
      created_by: '', created_at: o.queuedAt, updated_at: o.queuedAt, pending: true,
      expense_splits: r.ok ? Object.entries(r.shares).map(([user_id, amount_owed]) => ({ user_id, amount_owed })) : [],
    });
  }
  return { saves, deletes };
}

/** Server balances, adjusted for expenses still waiting to sync so offline users see the effect straight away. */
export function useNets(id: string) {
  const q = useQuery({
    queryKey: keys.nets(id), enabled: !!id,
    queryFn: async () => Object.fromEntries((await unwrap<{ user_id: string; net: number }[]>(supabase.rpc('group_nets', { p_group: id })))
      .map((r) => [r.user_id, Number(r.net)])) as Record<string, number>,
  });
  const { saves } = usePendingExpenses(id);
  const exp = useExpenses(id);
  if (!q.data || saves.length === 0) return q;
  const nets = { ...q.data };
  const known = new Map((exp.data?.pages.flat() ?? []).map((e) => [e.id, e]));
  for (const e of saves) {
    const before = known.get(e.id); // an offline edit replaces the server version
    if (before) {
      nets[before.paid_by] = (nets[before.paid_by] ?? 0) - Number(before.total_amount);
      for (const s of before.expense_splits) nets[s.user_id] = (nets[s.user_id] ?? 0) + Number(s.amount_owed);
    }
    nets[e.paid_by] = (nets[e.paid_by] ?? 0) + e.total_amount;
    for (const s of e.expense_splits) nets[s.user_id] = (nets[s.user_id] ?? 0) - s.amount_owed;
  }
  return { ...q, data: nets };
}

export function useSettlements(id: string) {
  return useQuery({
    queryKey: keys.settlements(id), enabled: !!id,
    queryFn: () => unwrap<Settlement[]>(supabase.from('settlements').select('*').eq('group_id', id).order('created_at', { ascending: false }).limit(100)),
  });
}

export function useInvites(id: string, enabled = true) {
  return useQuery({
    queryKey: keys.invites(id), enabled: !!id && enabled,
    queryFn: () => unwrap<Invite[]>(supabase.from('invites').select('id, phone, email, token, created_at').eq('group_id', id).is('accepted_at', null).order('created_at')),
  });
}

export function useNotifications() {
  const uid = useUserId();
  return useQuery({
    queryKey: keys.notifications, enabled: !!uid,
    queryFn: () => unwrap<Notification[]>(supabase.from('notifications').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(60)),
  });
}

export function useActivity() {
  return useQuery({
    queryKey: keys.activity,
    queryFn: () => unwrap<ActivityRow[]>(supabase.from('activity').select('id, group_id, kind, summary, created_at, groups(name)').order('created_at', { ascending: false }).limit(100)),
  });
}

/** Any database function as a mutation; refreshes the given query keys afterwards. */
export function useRpc<A extends object, R = any>(fn: string, invalidate: (args: A) => readonly unknown[][] = () => []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: A) => unwrap<R>(supabase.rpc(fn, args)),
    onSuccess: (_d, args) => { for (const k of invalidate(args)) qc.invalidateQueries({ queryKey: k }); },
  });
}

export function invalidateGroup(qc: ReturnType<typeof useQueryClient>, id: string) {
  qc.invalidateQueries({ queryKey: keys.group(id) });
  qc.invalidateQueries({ queryKey: keys.myGroups });
  qc.invalidateQueries({ queryKey: keys.activity });
}

/** Saves through the offline queue: instant on screen, synced now or when the connection returns. */
export async function queueSaveExpense(args: SaveExpenseArgs) {
  await outbox.add({ kind: 'save', groupId: args.p_group, args });
  void outbox.flush();
}
export async function queueDeleteExpense(groupId: string, id: string) {
  await outbox.add({ kind: 'delete', groupId, args: { p_id: id } });
  void outbox.flush();
}
