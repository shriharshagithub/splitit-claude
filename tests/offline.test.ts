import { beforeEach, describe, expect, it, vi } from 'vitest';

// The outbox runs in the app; here it is exercised with storage, network status and the API mocked.
const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    multiGet: async (keys: string[]) => keys.map((k) => [k, store.get(k) ?? null]),
    multiSet: async (pairs: [string, string][]) => pairs.forEach(([k, v]) => store.set(k, v)),
    multiRemove: async (keys: string[]) => keys.forEach((k) => store.delete(k)),
  },
}));
let netListener: ((s: { isConnected: boolean; isInternetReachable: boolean | null }) => void) | null = null;
vi.mock('@react-native-community/netinfo', () => ({ default: { addEventListener: (l: typeof netListener) => { netListener = l; return () => undefined; } } }));
vi.mock('@tanstack/react-query', () => ({ onlineManager: { setOnline: () => undefined } }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' }, AppState: { addEventListener: () => ({ remove: () => undefined }) } }));
const saved: string[] = [];
let failNetwork = false;
vi.mock('../src/lib/api', () => ({
  saveExpense: async (p: { id: string }) => {
    if (failNetwork) throw new Error('Network request failed');
    saved.push(p.id);
    return { id: p.id, updated_at: '', conflict: p.id === 'conflicting', created: true };
  },
  deleteExpense: async () => undefined,
}));

const payload = (id: string) => ({ id, group_id: 'g', paid_by: 'u', total_amount: 100, description: id, category: 'food', expense_date: '2026-11-11', split_type: 'equal' as const, inputs: [{ user_id: 'u' }] });

describe('offline outbox', () => {
  beforeEach(() => { store.clear(); saved.length = 0; failNetwork = false; vi.resetModules(); });

  it('queues while offline, survives a restart, and syncs on reconnect', async () => {
    let mod = await import('../src/lib/offline');
    await mod.initOffline(() => undefined);
    netListener!({ isConnected: false, isInternetReachable: false });
    expect(await mod.saveExpenseOrQueue(payload('a'), 'Chai')).toBe('queued');
    expect(await mod.saveExpenseOrQueue(payload('b'), 'Dosa')).toBe('queued');
    expect(JSON.parse(store.get('splitit.outbox.v1')!)).toHaveLength(2);

    // "force-close": load the module fresh from storage
    vi.resetModules();
    failNetwork = true; // still no network after reopening
    mod = await import('../src/lib/offline');
    await mod.initOffline(() => undefined);
    netListener!({ isConnected: false, isInternetReachable: false });
    expect(saved).toEqual([]);
    expect(JSON.parse(store.get('splitit.outbox.v1')!)).toHaveLength(2);
    failNetwork = false;
    netListener!({ isConnected: true, isInternetReachable: true });
    await mod.flush();
    await new Promise((r) => setTimeout(r, 0));
    expect(saved).toEqual(['a', 'b']);
    expect(JSON.parse(store.get('splitit.outbox.v1')!)).toHaveLength(0);
  });

  it('a network failure while online queues instead of losing the expense', async () => {
    const mod = await import('../src/lib/offline');
    await mod.initOffline(() => undefined);
    netListener!({ isConnected: true, isInternetReachable: true });
    failNetwork = true;
    expect(await mod.saveExpenseOrQueue(payload('c'), 'Lunch')).toBe('queued');
    failNetwork = false;
    await mod.flush();
    expect(saved).toEqual(['c']);
  });

  it('reports last-write-wins conflicts to the user', async () => {
    const mod = await import('../src/lib/offline');
    await mod.initOffline(() => undefined);
    netListener!({ isConnected: false, isInternetReachable: false });
    await mod.saveExpenseOrQueue(payload('conflicting'), 'Groceries');
    netListener!({ isConnected: true, isInternetReachable: true });
    await mod.flush();
    const notices = JSON.parse(store.get('splitit.syncnotices.v1')!);
    expect(notices[0].text).toMatch(/"Groceries" was also changed by someone else/);
  });
});
