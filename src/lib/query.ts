import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';

const WEEK = 7 * 24 * 3600 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Serve cached data first and keep it for a week so the app reads offline.
      networkMode: 'offlineFirst',
      gcTime: WEEK,
      staleTime: 15_000,
      retry: (count, err) => count < 2 && !(err instanceof Error && /not a member|does not exist/i.test(err.message)),
    },
    mutations: { networkMode: 'always' },
  },
});

export const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: 'splitit.cache.v1', throttleTime: 1000 });
export const persistMaxAge = WEEK;

export const qk = {
  profile: (id: string) => ['profile', id] as const,
  groups: ['groups'] as const,
  group: (id: string) => ['group', id] as const,
  nets: (id: string) => ['nets', id] as const,
  expenses: (id: string) => ['expenses', id] as const,
  expense: (id: string) => ['expense', id] as const,
  settlements: (id: string) => ['settlements', id] as const,
  notifications: ['notifications'] as const,
  activity: ['activity'] as const,
};

/** Refresh everything a money change can affect. */
export function invalidateMoney(groupId?: string) {
  void queryClient.invalidateQueries({ queryKey: qk.groups });
  void queryClient.invalidateQueries({ queryKey: qk.activity });
  void queryClient.invalidateQueries({ queryKey: qk.notifications });
  if (groupId) {
    void queryClient.invalidateQueries({ queryKey: qk.nets(groupId) });
    void queryClient.invalidateQueries({ queryKey: qk.expenses(groupId) });
    void queryClient.invalidateQueries({ queryKey: qk.settlements(groupId) });
  } else {
    void queryClient.invalidateQueries({ queryKey: ['nets'] });
    void queryClient.invalidateQueries({ queryKey: ['expenses'] });
    void queryClient.invalidateQueries({ queryKey: ['settlements'] });
  }
}
