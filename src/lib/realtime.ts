import { focusManager } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { useAuth } from './auth';
import { invalidateMoney, queryClient, qk } from './query';
import { supabase } from './supabase';

type Row = { group_id?: string } | null | undefined;

/**
 * Keeps every open screen current without pull-to-refresh:
 * - live database changes (expenses, payments, members, notifications) refresh the affected data;
 * - coming back to the app refreshes stale data (the web does this on tab focus already).
 */
export function useLiveUpdates() {
  const { session } = useAuth();
  const userId = session?.user.id;

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!userId) return;
    // Bursts of changes (an expense writes several rows) collapse into one refresh per group.
    const pending = new Set<string>();
    let all = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (groupId?: string) => {
      if (groupId) pending.add(groupId);
      else all = true;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (all) invalidateMoney();
        else pending.forEach((g) => invalidateMoney(g));
        pending.clear();
        all = false;
      }, 400);
    };
    const onMoney = (p: { new: Row; old: Row }) => schedule(p.new?.group_id ?? p.old?.group_id);

    const channel = supabase
      .channel(`live:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, onMoney)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements' }, onMoney)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members' }, (p: { new: Row; old: Row }) => {
        const g = p.new?.group_id ?? p.old?.group_id;
        if (g) void queryClient.invalidateQueries({ queryKey: qk.group(g) });
        schedule(g);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: qk.notifications });
        void queryClient.invalidateQueries({ queryKey: qk.activity });
      })
      .subscribe((status) => {
        // After a dropped connection comes back, catch up on anything missed.
        if (status === 'SUBSCRIBED') schedule();
      });

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [userId]);
}
