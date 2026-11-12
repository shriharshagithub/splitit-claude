import { describe, expect, it } from 'vitest';
import { createOutbox, type KV, type SaveExpenseArgs } from '../src/lib/outbox';

function memoryKV(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => { data.set(k, v); } };
}
const args = (id: string, extra: Partial<SaveExpenseArgs> = {}): SaveExpenseArgs => ({
  p_id: id, p_group: 'g', p_paid_by: 'a', p_total: 100, p_description: `exp ${id}`, p_category: 'food', p_date: '2026-11-10',
  p_split_type: 'equal', p_members: ['a', 'b'], p_values: {}, ...extra,
});

describe('offline outbox', () => {
  it('queues while offline, survives an app restart, and syncs in order on reconnect', async () => {
    const kv = memoryKV();
    let online = false;
    const calls: string[] = [];
    const rpc = async (fn: string, a: any) => { if (!online) throw new Error('Network request failed'); calls.push(`${fn}:${a.p_id}`); return { data: { id: a.p_id }, error: null }; };
    const box1 = createOutbox(kv, rpc, () => online);
    await box1.add({ kind: 'save', groupId: 'g', args: args('1') });
    await box1.add({ kind: 'save', groupId: 'g', args: args('2') });
    await box1.flush();
    expect(box1.count()).toBe(2);
    // "force-close": a new outbox instance reads the same storage
    const box2 = createOutbox(kv, rpc, () => online);
    await box2.load();
    expect(box2.count()).toBe(2);
    online = true;
    await box2.flush();
    expect(calls).toEqual(['save_expense:1', 'save_expense:2']);
    expect(box2.count()).toBe(0);
  });

  it('a network error while online keeps the change queued instead of losing it', async () => {
    const kv = memoryKV();
    const rpc = async () => ({ data: null, error: { message: 'TypeError: Failed to fetch' } });
    const box = createOutbox(kv, rpc, () => true);
    await box.add({ kind: 'save', groupId: 'g', args: args('1') });
    await box.flush();
    expect(box.count()).toBe(1);
  });

  it('tells the person about a last-write-wins conflict and about rejected changes', async () => {
    const kv = memoryKV();
    const rpc = async (_f: string, a: any) => (a.p_id === 'x' ? { data: null, error: { message: 'You are not in this group.' } } : { data: { conflict: true }, error: null });
    const box = createOutbox(kv, rpc, () => false);
    const notices: string[] = [];
    box.onNotice((n) => notices.push(n.kind));
    await box.add({ kind: 'save', groupId: 'g', args: args('1', { p_base_updated_at: '2026-11-01T00:00:00Z' }) });
    await box.add({ kind: 'save', groupId: 'g', args: args('x') });
    const live = createOutbox(kv, rpc, () => true);
    live.onNotice((n) => notices.push(n.kind));
    await live.flush();
    expect(notices).toEqual(['conflict', 'rejected']);
    expect(live.count()).toBe(0);
  });

  it('editing a queued expense replaces it; deleting one that never synced just drops it', async () => {
    const kv = memoryKV();
    const box = createOutbox(kv, async () => ({ data: {}, error: null }), () => false);
    await box.add({ kind: 'save', groupId: 'g', args: args('1') });
    await box.add({ kind: 'save', groupId: 'g', args: args('1', { p_total: 500 }) });
    expect(box.count()).toBe(1);
    expect((box.pending()[0] as any).args.p_total).toBe(500);
    await box.add({ kind: 'delete', groupId: 'g', args: { p_id: '1' } });
    expect(box.count()).toBe(0);
  });
});
