import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { createOutbox } from './outbox';
import { isOnline } from './network';
import { supabase } from './supabase';
import { computeSplits } from '@/core';
import { queryClient } from './query';

export const outbox = createOutbox(AsyncStorage, (fn, args) => supabase.rpc(fn, args) as any, isOnline);

export function usePendingOps() {
  return useSyncExternalStore(outbox.subscribe, outbox.pending, outbox.pending);
}

// When a queued change reaches the server, put it into the on-screen list straight away
// (so it never disappears between "synced" and the next refresh), then refresh from the server.
outbox.onSynced((op) => {
  const key = ['group', op.groupId, 'expenses'];
  queryClient.setQueryData(key, (old: any) => {
    if (!old?.pages) return old;
    const pages = old.pages.map((p: any[]) => p.filter((e) => e.id !== op.args.p_id));
    if (op.kind === 'save') {
      const a = op.args;
      const r = computeSplits({ total: a.p_total, payer: a.p_paid_by, type: a.p_split_type as any, members: a.p_members, values: a.p_values });
      const now = new Date().toISOString();
      pages[0] = [{ id: a.p_id, group_id: a.p_group, paid_by: a.p_paid_by, total_amount: a.p_total, description: a.p_description, category: a.p_category,
        expense_date: a.p_date, split_type: a.p_split_type, split_values: a.p_values, receipt_url: a.p_receipt_url ?? null, created_by: '', created_at: now, updated_at: now,
        expense_splits: r.ok ? Object.entries(r.shares).map(([user_id, amount_owed]) => ({ user_id, amount_owed })) : [] }, ...(pages[0] ?? [])];
    }
    return { ...old, pages };
  });
  queryClient.invalidateQueries({ queryKey: ['group', op.groupId] });
  queryClient.invalidateQueries({ queryKey: ['myGroups'] });
});
