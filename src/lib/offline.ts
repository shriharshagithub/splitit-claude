// Offline support: an outbox of expense writes kept in AsyncStorage (survives force-close),
// replayed in order when the network comes back. The server applies last-write-wins and
// reports conflicts, which are shown to the user.
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { deleteExpense, saveExpense } from './api';
import { isNetworkError, toAppError } from './errors';
import type { ExpensePayload } from './types';

export type OutboxItem =
  | { key: string; op: 'save_expense'; groupId: string; label: string; queuedAt: string; payload: ExpensePayload }
  | { key: string; op: 'delete_expense'; groupId: string; label: string; queuedAt: string; payload: { id: string } };

export interface SyncNotice {
  key: string;
  kind: 'conflict' | 'rejected';
  text: string;
}

interface State {
  ready: boolean;
  online: boolean;
  syncing: boolean;
  outbox: OutboxItem[];
  notices: SyncNotice[];
}

const KEY = 'splitit.outbox.v1';
const NOTICE_KEY = 'splitit.syncnotices.v1';
let state: State = { ready: false, online: true, syncing: false, outbox: [], notices: [] };
const listeners = new Set<() => void>();
let afterSync: (() => void) | null = null;

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

async function persist() {
  await AsyncStorage.multiSet([[KEY, JSON.stringify(state.outbox)], [NOTICE_KEY, JSON.stringify(state.notices)]]);
}

export function useSync(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

export const isOnline = () => state.online;

/** Load the queue from disk and start watching connectivity. Call once at startup. */
export async function initOffline(onSynced: () => void) {
  afterSync = onSynced;
  try {
    const [[, ob], [, nt]] = await AsyncStorage.multiGet([KEY, NOTICE_KEY]);
    set({ outbox: ob ? JSON.parse(ob) : [], notices: nt ? JSON.parse(nt) : [], ready: true });
  } catch {
    set({ ready: true });
  }
  const setOnline = (online: boolean) => {
    const cameBack = online && !state.online;
    if (online !== state.online) set({ online });
    onlineManager.setOnline(online);
    if (cameBack) void flush();
  };
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    // Browsers report connectivity directly. NetInfo's extra reachability probe can fail behind
    // proxies or strict networks and would wrongly show the app as offline, so it is not used here.
    setOnline(navigator.onLine);
    window.addEventListener('online', () => setOnline(true));
    window.addEventListener('offline', () => setOnline(false));
  } else {
    // On phones, trust the connection state; a failed request is retried by the queue anyway.
    NetInfo.addEventListener((s) => setOnline(s.isConnected !== false));
  }
  // Safety net: retry queued writes every 15 s and whenever the app comes to the foreground.
  setInterval(() => { if (state.outbox.length) void flush(); }, 15_000);
  AppState.addEventListener('change', (s) => { if (s === 'active') void flush(); });
  void flush();
}

/** A request failed with a network error: treat the device as offline until it proves otherwise. */
export function noteNetworkFailure() {
  if (state.online) set({ online: false });
  onlineManager.setOnline(false);
}

export async function enqueue(item: Omit<OutboxItem, 'queuedAt'>) {
  // A later write to the same expense replaces an earlier queued one.
  const outbox = state.outbox.filter((o) => o.payload.id !== item.payload.id || o.op !== item.op);
  set({ outbox: [...outbox, { ...item, queuedAt: new Date().toISOString() } as OutboxItem] });
  await persist();
}

export async function dismissNotice(key: string) {
  set({ notices: state.notices.filter((n) => n.key !== key) });
  await persist();
}

/** Save now if online; otherwise (or if the network drops mid-request) queue it. */
export async function saveExpenseOrQueue(p: ExpensePayload, label: string): Promise<'saved' | 'queued'> {
  if (state.online) {
    try {
      const r = await saveExpense(p);
      if (r.conflict) addNotice('conflict', `"${label}" was changed by someone else while you were editing. Your version was kept.`);
      return 'saved';
    } catch (e) {
      if (!isNetworkError(e)) throw e;
    }
  }
  await enqueue({ key: `save:${p.id}`, op: 'save_expense', groupId: p.group_id, label, payload: p });
  return 'queued';
}

export async function deleteExpenseOrQueue(id: string, groupId: string, label: string): Promise<'saved' | 'queued'> {
  if (state.online) {
    try {
      await deleteExpense(id);
      return 'saved';
    } catch (e) {
      if (!isNetworkError(e)) throw e;
    }
  }
  // Deleting something that only exists in the queue just drops it.
  if (state.outbox.some((o) => o.op === 'save_expense' && o.payload.id === id && o.payload.base_updated_at === undefined)) {
    set({ outbox: state.outbox.filter((o) => o.payload.id !== id) });
    await persist();
    return 'saved';
  }
  await enqueue({ key: `delete:${id}`, op: 'delete_expense', groupId, label, payload: { id } });
  return 'queued';
}

function addNotice(kind: SyncNotice['kind'], text: string) {
  set({ notices: [...state.notices, { key: `${Date.now()}-${Math.random()}`, kind, text }] });
  void persist();
}

let flushing: Promise<void> | null = null;

export function flush(): Promise<void> {
  if (flushing) return flushing;
  if (!state.online || state.outbox.length === 0) return Promise.resolve();
  flushing = (async () => {
    set({ syncing: true });
    let changed = false;
    try {
      while (state.outbox.length && state.online) {
        const item = state.outbox[0];
        try {
          if (item.op === 'save_expense') {
            const r = await saveExpense(item.payload);
            if (r.conflict) addNotice('conflict', `"${item.label}" was also changed by someone else while you were offline. Your version was kept.`);
          } else {
            await deleteExpense(item.payload.id);
          }
        } catch (e) {
          if (isNetworkError(e)) break;
          const err = toAppError(e);
          if (err.kind === 'auth') break;
          // The server refused it (for example, you were removed from the group). Drop it and say why.
          if (!(item.op === 'delete_expense' && /no longer exists/i.test(err.message))) {
            addNotice('rejected', `"${item.label}" could not be synced: ${err.message}`);
          }
        }
        set({ outbox: state.outbox.slice(1) });
        await persist();
        changed = true;
      }
    } finally {
      set({ syncing: false });
      flushing = null;
      if (changed) afterSync?.();
    }
  })();
  return flushing;
}

export async function clearOffline() {
  set({ outbox: [], notices: [] });
  await AsyncStorage.multiRemove([KEY, NOTICE_KEY]);
}
