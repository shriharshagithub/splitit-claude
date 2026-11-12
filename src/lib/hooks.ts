import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { simplifyDebts, type Transfer } from '@/core';
import * as api from './api';
import { useAuth } from './auth';
import { useSync } from './offline';
import { qk } from './query';
import type { ExpenseRow } from './types';

const useSignedIn = () => Boolean(useAuth().session);

export const useMyGroups = () => useQuery({ queryKey: qk.groups, queryFn: api.getMyGroups, refetchInterval: 60_000, enabled: useSignedIn() });
export const useGroup = (id: string) => useQuery({ queryKey: qk.group(id), queryFn: () => api.getGroup(id), enabled: !!id });
export const useNets = (id: string) => useQuery({ queryKey: qk.nets(id), queryFn: () => api.getNets(id), enabled: !!id });
export const useOpenSettlements = (id: string) =>
  useQuery({ queryKey: qk.settlements(id), queryFn: () => api.getOpenSettlements(id), enabled: !!id });
export const useNotifications = () =>
  useQuery({ queryKey: qk.notifications, queryFn: api.getNotifications, refetchInterval: 30_000, enabled: useSignedIn() });
export const useActivity = () => useQuery({ queryKey: qk.activity, queryFn: api.getActivity, refetchInterval: 60_000, enabled: useSignedIn() });

export function useUnreadCount(): number {
  const { data } = useNotifications();
  return (data ?? []).filter((n) => !n.read_at).length;
}

/** Simplified "who pays whom" for a group, from server balances. */
export function useTransfers(groupId: string): { transfers: Transfer[] | undefined; nets: Record<string, number> | undefined; isLoading: boolean; error: unknown; refetch: () => void } {
  const q = useNets(groupId);
  const transfers = useMemo(() => (q.data ? simplifyDebts(q.data) : undefined), [q.data]);
  return { transfers, nets: q.data, isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

/** Expense feed: server pages (30 at a time) plus anything waiting in the offline queue. */
export function useExpenseFeed(groupId: string, me: string) {
  const q = useInfiniteQuery({
    queryKey: qk.expenses(groupId),
    queryFn: ({ pageParam }) => api.getExpensesPage(groupId, pageParam),
    initialPageParam: undefined as undefined | { date: string; created: string },
    getNextPageParam: (last) => (last.length < 30 ? undefined : { date: last[last.length - 1].expense_date, created: last[last.length - 1].created_at }),
    enabled: !!groupId,
  });
  const { outbox } = useSync();
  const rows = useMemo(() => {
    const server = q.data?.pages.flat() ?? [];
    const deleting = new Set(outbox.filter((o) => o.op === 'delete_expense' && o.groupId === groupId).map((o) => o.payload.id));
    const pending = new Map<string, ExpenseRow>();
    for (const o of outbox) {
      if (o.op !== 'save_expense' || o.groupId !== groupId) continue;
      const p = o.payload;
      pending.set(p.id, {
        id: p.id, description: p.description, category: p.category, total_amount: p.total_amount, expense_date: p.expense_date,
        paid_by: p.paid_by, payer_name: '', split_type: p.split_type, created_by: me, created_at: o.queuedAt, updated_at: o.queuedAt,
        my_owed: 0, has_receipt: false, pending: true,
      });
    }
    const merged = server.filter((r) => !deleting.has(r.id) && !pending.has(r.id));
    return [...pending.values(), ...merged].sort((a, b) =>
      b.expense_date.localeCompare(a.expense_date) || b.created_at.localeCompare(a.created_at));
  }, [q.data, outbox, groupId, me]);
  return { ...q, rows };
}
