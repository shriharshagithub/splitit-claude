import type { Paise } from './money';

export interface Transfer {
  from: string;
  to: string;
  amount: Paise;
}

/** Net position per user: positive = is owed money, negative = owes money. Must sum to 0. */
export type Nets = Record<string, Paise>;

const EXACT_LIMIT = 16;

function greedy(entries: [string, number][]): Transfer[] {
  const debtors = entries.filter(([, v]) => v < 0).map(([u, v]) => ({ u, v: -v }));
  const creditors = entries.filter(([, v]) => v > 0).map(([u, v]) => ({ u, v }));
  const byAmount = (a: { u: string; v: number }, b: { u: string; v: number }) => b.v - a.v || (a.u < b.u ? -1 : 1);
  const out: Transfer[] = [];
  while (debtors.length && creditors.length) {
    debtors.sort(byAmount);
    creditors.sort(byAmount);
    const d = debtors[0];
    const c = creditors[0];
    const amt = Math.min(d.v, c.v);
    out.push({ from: d.u, to: c.u, amount: amt });
    d.v -= amt;
    c.v -= amt;
    if (d.v === 0) debtors.shift();
    if (c.v === 0) creditors.shift();
  }
  return out;
}

/**
 * Smallest set of transfers that clears every debt.
 * The minimum equals (people with a non-zero balance) minus (the largest number of
 * disjoint zero-sum groups they can be split into). That partition is found exactly
 * with a subset DP for up to 16 people; above that, greedy matching is used (at most n-1 transfers).
 */
export function simplifyDebts(nets: Nets): Transfer[] {
  const entries = Object.entries(nets)
    .filter(([, v]) => v !== 0)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  const total = entries.reduce((a, [, v]) => a + v, 0);
  if (total !== 0) throw new Error(`balances do not sum to zero (${total})`);
  const n = entries.length;
  if (n === 0) return [];
  if (n > EXACT_LIMIT) return greedy(entries);

  const size = 1 << n;
  const sum = new Array<number>(size).fill(0);
  for (let m = 1; m < size; m++) {
    const low = m & -m;
    sum[m] = sum[m ^ low] + entries[31 - Math.clz32(low)][1];
  }
  const dp = new Int16Array(size);
  const pick = new Int8Array(size);
  for (let m = 1; m < size; m++) {
    let best = -1;
    let bi = 0;
    for (let i = 0; i < n; i++) {
      if (m & (1 << i)) {
        const v = dp[m ^ (1 << i)];
        if (v > best) {
          best = v;
          bi = i;
        }
      }
    }
    dp[m] = best + (sum[m] === 0 ? 1 : 0);
    pick[m] = bi;
  }
  // Reconstruct an order whose zero prefix sums mark the groups.
  const order: number[] = [];
  for (let m = size - 1; m; m ^= 1 << pick[m]) order.push(pick[m]);
  order.reverse();
  const out: Transfer[] = [];
  let group: [string, number][] = [];
  let run = 0;
  for (const i of order) {
    group.push(entries[i]);
    run += entries[i][1];
    if (run === 0) {
      out.push(...greedy(group));
      group = [];
    }
  }
  return out;
}
