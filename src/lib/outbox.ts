/**
 * Offline queue for expense changes. Each operation is stored on the device (survives closing the app)
 * and replayed in order when the connection returns. Expense IDs are made on the phone, so replaying
 * the same operation twice can never create a duplicate.
 */
export type OutboxOp =
  | { key: string; kind: 'save'; groupId: string; queuedAt: string; args: SaveExpenseArgs }
  | { key: string; kind: 'delete'; groupId: string; queuedAt: string; args: { p_id: string } };

export interface SaveExpenseArgs {
  p_id: string; p_group: string; p_paid_by: string; p_total: number; p_description: string; p_category: string;
  p_date: string; p_split_type: string; p_members: string[]; p_values: Record<string, number>;
  p_items?: { name: string; amount: number; assignees: string[] }[] | null; p_receipt_url?: string | null;
  p_base_updated_at?: string | null;
}

export interface KV { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void> }
export type Rpc = (fn: string, args: object) => Promise<{ data: any; error: { message: string } | null }>;
export interface Notice { kind: 'conflict' | 'rejected'; text: string }

const KEY = 'splitit.outbox.v1';
const NETWORK = /Failed to fetch|Network request failed|fetch failed|NetworkError|timeout|ECONN|ENOTFOUND|Load failed/i;

export function createOutbox(kv: KV, rpc: Rpc, isOnline: () => boolean) {
  let ops: OutboxOp[] = [];
  let loaded = false;
  let flushing: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const noticeListeners = new Set<(n: Notice) => void>();
  const syncedListeners = new Set<(op: OutboxOp, result: any) => void>();
  const emit = () => listeners.forEach((f) => f());

  async function load() {
    if (loaded) return;
    try { ops = JSON.parse((await kv.getItem(KEY)) ?? '[]'); } catch { ops = []; }
    loaded = true;
    emit();
  }
  async function persist() {
    await kv.setItem(KEY, JSON.stringify(ops));
    emit();
  }

  async function add(op: Omit<OutboxOp, 'key' | 'queuedAt'>) {
    await load();
    const full = { ...op, key: `${Date.now()}-${Math.random().toString(36).slice(2)}`, queuedAt: new Date().toISOString() } as OutboxOp;
    if (full.kind === 'delete') {
      // Deleting an expense that was created offline and never reached the server: just drop it.
      const queued = ops.find((o) => o.kind === 'save' && o.args.p_id === full.args.p_id) as Extract<OutboxOp, { kind: 'save' }> | undefined;
      ops = ops.filter((o) => o !== queued);
      if (queued && !queued.args.p_base_updated_at) { await persist(); return; }
    } else {
      // A newer edit of the same queued expense replaces the older one.
      ops = ops.filter((o) => !(o.kind === 'save' && o.args.p_id === (full as any).args.p_id));
    }
    ops = [...ops, full];
    await persist();
  }

  /** Replays queued operations. Stops at the first network failure and keeps the rest. */
  function flush(): Promise<void> {
    if (flushing) return flushing;
    flushing = (async () => {
      await load();
      while (ops.length && isOnline()) {
        const op = ops[0];
        let res: Awaited<ReturnType<Rpc>>;
        try {
          res = op.kind === 'save' ? await rpc('save_expense', op.args) : await rpc('delete_expense', op.args);
        } catch (e) {
          if (NETWORK.test(String((e as Error)?.message ?? e))) break;
          res = { data: null, error: { message: String((e as Error)?.message ?? e) } };
        }
        if (res.error && NETWORK.test(res.error.message)) break;
        // Never mutate in place: screens compare the list by reference to know it changed.
        ops = ops.filter((o) => o.key !== op.key);
        await persist();
        if (res.error) {
          const what = op.kind === 'save' ? `"${op.args.p_description}"` : 'a deleted expense';
          noticeListeners.forEach((f) => f({ kind: 'rejected', text: `Could not sync ${what}: ${res.error!.message}` }));
        } else {
          syncedListeners.forEach((f) => f(op, res.data));
        }
        if (!res.error && op.kind === 'save' && res.data?.conflict) {
          noticeListeners.forEach((f) => f({ kind: 'conflict', text: `"${op.args.p_description}" was also changed by someone else. Your offline edit was saved last, so it is the one that counts.` }));
        }
      }
    })().finally(() => { flushing = null; });
    return flushing;
  }

  return {
    load, add, flush,
    pending: () => ops,
    count: () => ops.length,
    subscribe(f: () => void) { listeners.add(f); return () => listeners.delete(f); },
    onNotice(f: (n: Notice) => void) { noticeListeners.add(f); return () => noticeListeners.delete(f); },
    onSynced(f: (op: OutboxOp, result: any) => void) { syncedListeners.add(f); return () => syncedListeners.delete(f); },
  };
}
export type Outbox = ReturnType<typeof createOutbox>;
