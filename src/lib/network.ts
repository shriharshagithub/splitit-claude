import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

// Web: trust the browser's online/offline events (NetInfo's reachability probe gives false "offline" on web).
// Native: NetInfo. Either way, React Query pauses and resumes requests with it.
let online = Platform.OS === 'web' && typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
const subs = new Set<() => void>();
function set(v: boolean) {
  if (v === online) return;
  online = v;
  onlineManager.setOnline(v);
  subs.forEach((f) => f());
}

export function startNetworkWatch(): () => void {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return () => {};
    const up = () => set(true);
    const down = () => set(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    onlineManager.setOnline(online);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }
  return NetInfo.addEventListener((s) => set(s.isConnected !== false && s.isInternetReachable !== false));
}

export function isOnline(): boolean {
  return online;
}

export function onNetworkChange(f: () => void): () => void {
  subs.add(f);
  return () => subs.delete(f);
}

export function useOnline(): boolean {
  return useSyncExternalStore(onNetworkChange, isOnline, isOnline);
}
