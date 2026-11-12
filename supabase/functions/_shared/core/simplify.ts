// GENERATED from src/core/simplify.ts by scripts/sync-shared.mjs. Do not edit.
import type { Paise } from './money.ts';

export interface Transfer { from: string; to: string; amount: Paise }

/** Above this many people with a non-zero balance we fall back to greedy matching. */
export const EXACT_LIMIT = 16;

function greedy(entries: [string, number][]): Transfer[] {
  const debt = entries.filter(([, v]) => v < 0).map(([k, v]) => ({ k, v: -v }));
  const cred = entries.filter(([, v]) => v > 0).map(([k, v]) => ({ k, v }));
  const out: Transfer[] = [];
  for (;;) {
    debt.sort((a, b) => b.v - a.v || a.k.localeCompare(b.k));
    cred.sort((a, b) => b.v - a.v || a.k.localeCompare(b.k));
    const d = debt[0];
    const c = cred[0];
    if (!d || !c || d.v === 0 || c.v === 0) break;
    const amt = Math.min(d.v, c.v);
    out.push({ from: d.k, to: c.k, amount: amt });
    d.v -= amt;
    c.v -= amt;
    if (d.v === 0) debt.shift();
    if (c.v === 0) cred.shift();
  }
  return out;
}

/**
 * Fewest payments that clear every balance. `nets` maps person -> net (positive = is owed).
 * Exact: the minimum number of payments is n - k, where k is the largest number of disjoint
 * groups whose balances sum to zero. We find k with a subset DP (2^n states, n <= 16),
 * then settle each zero-sum group greedily (a group of size m needs m - 1 payments).
 */
export function simplifyDebts(nets: Record<string, Paise>): Transfer[] {
  const entries = Object.entries(nets).filter(([, v]) => v !== 0).sort(([a], [b]) => a.localeCompare(b));
  const sum = entries.reduce((a, [, v]) => a + v, 0);
  if (sum !== 0) throw new Error('balances do not add up to zero');
  const n = entries.length;
  if (n === 0) return [];
  if (n > EXACT_LIMIT) return greedy(entries);

  const full = (1 << n) - 1;
  const sums = new Float64Array(1 << n);
  for (let m = 1; m <= full; m++) {
    const low = m & -m;
    sums[m] = sums[m ^ low] + entries[31 - Math.clz32(low)][1];
  }
  // dp[m] = max number of zero-sum groups that m can be split into (only meaningful when sums[m] == 0)
  const dp = new Int8Array(1 << n).fill(-1);
  const choice = new Int32Array(1 << n);
  dp[0] = 0;
  for (let m = 1; m <= full; m++) {
    if (sums[m] !== 0) continue;
    // Always include the lowest set bit in the sub-group to avoid counting orders twice.
    const low = m & -m;
    const rest = m ^ low;
    for (let s = rest; ; s = (s - 1) & rest) {
      const g = s | low;
      if (sums[g] === 0 && dp[m ^ g] >= 0 && dp[m ^ g] + 1 > dp[m]) {
        dp[m] = dp[m ^ g] + 1;
        choice[m] = g;
      }
      if (s === 0) break;
    }
  }
  const out: Transfer[] = [];
  for (let m = full; m; m ^= choice[m]) {
    const g = choice[m];
    const members: [string, number][] = [];
    for (let i = 0; i < n; i++) if (g & (1 << i)) members.push(entries[i]);
    out.push(...greedy(members));
  }
  return out;
}

/** Net balance per person from transfers, for checking. */
export function applyTransfers(nets: Record<string, Paise>, ts: Transfer[]): Record<string, Paise> {
  const r = { ...nets };
  for (const t of ts) {
    r[t.from] = (r[t.from] ?? 0) + t.amount;
    r[t.to] = (r[t.to] ?? 0) - t.amount;
  }
  return r;
}
