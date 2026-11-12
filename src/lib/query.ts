import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'offlineFirst',
      gcTime: 7 * 24 * 3600_000, // keep a week of data on the phone for offline reading
      staleTime: 15_000,
      retry: (n, e: any) => n < 2 && !/not in this group|not in it|log in/i.test(e?.message ?? ''),
    },
    mutations: { networkMode: 'always' },
  },
});

export const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: 'splitit.cache.v1', throttleTime: 500 });
