import { useQueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useEffect } from 'react';
import { keys } from './api';
import { useAuth } from './auth';
import { supabase } from './supabase';

// One private channel per topic, shared by every screen that needs it.
const channels = new Map<string, { ch: RealtimeChannel; subs: Set<() => void> }>();

function listen(topic: string, f: () => void): () => void {
  let entry = channels.get(topic);
  if (!entry) {
    const subs = new Set<() => void>();
    const ch = supabase.channel(topic, { config: { private: true } })
      .on('broadcast', { event: 'change' }, () => subs.forEach((s) => s()))
      .subscribe();
    entry = { ch, subs };
    channels.set(topic, entry);
  }
  entry.subs.add(f);
  return () => {
    const e = channels.get(topic);
    if (!e) return;
    e.subs.delete(f);
    if (e.subs.size === 0) { supabase.removeChannel(e.ch); channels.delete(topic); }
  };
}

export function useLiveTopics(topics: string[], onChange: (topic: string) => void) {
  const { session } = useAuth();
  const sig = [...new Set(topics.filter(Boolean))].sort().join(',');
  useEffect(() => {
    if (!session || !sig) return;
    supabase.realtime.setAuth(session.access_token);
    const offs = sig.split(',').map((t) => listen(t, () => onChange(t)));
    return () => offs.forEach((o) => o());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, session?.user.id]);
}

/** Group screens and the home screen: refresh when anything in these groups changes. */
export function useLiveGroups(ids: string[]) {
  const qc = useQueryClient();
  useLiveTopics(ids.map((id) => `group:${id}`), (topic) => {
    const id = topic.slice(6);
    qc.invalidateQueries({ queryKey: keys.group(id) });
    qc.invalidateQueries({ queryKey: keys.myGroups });
    qc.invalidateQueries({ queryKey: keys.activity });
  });
}

/** My own notifications and group membership. Mounted once at the top of the app. */
export function useLiveUser() {
  const qc = useQueryClient();
  const { userId } = useAuth();
  useLiveTopics(userId ? [`user:${userId}`] : [], () => {
    qc.invalidateQueries({ queryKey: keys.notifications });
    qc.invalidateQueries({ queryKey: keys.myGroups });
    qc.invalidateQueries({ queryKey: keys.activity });
  });
}
