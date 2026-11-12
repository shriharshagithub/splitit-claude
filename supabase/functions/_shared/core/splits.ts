// GENERATED from src/core/splits.ts by scripts/sync-shared.mjs. Do not edit.
import type { Paise } from './money.ts';

export type SplitType = 'equal' | 'exact' | 'percentage' | 'shares';

export interface SplitInput {
  total: Paise;
  payer: string;
  type: SplitType;
  /** Members in the split, in display order. */
  members: string[];
  /** exact: paise per member; percentage: basis points (100% = 10000); shares: whole-number shares. Ignored for equal. */
  values?: Record<string, number>;
}

export type SplitResult = { ok: true; shares: Record<string, Paise> } | { ok: false; error: string };

/**
 * Same rules as the database function public.compute_splits:
 * floor each share, then give the leftover paise to the payer if they are in the split,
 * otherwise to the first member.
 */
export function computeSplits(input: SplitInput): SplitResult {
  const { total, payer, type, members } = input;
  const values = input.values ?? {};
  if (!Number.isSafeInteger(total) || total <= 0) return { ok: false, error: 'Enter an amount above ₹0.' };
  const uniq = [...new Set(members)];
  if (uniq.length === 0) return { ok: false, error: 'Pick at least one person to split with.' };

  const shares: Record<string, Paise> = {};
  let weights: number[];
  if (type === 'exact') {
    let sum = 0;
    for (const m of uniq) {
      const v = values[m] ?? 0;
      if (!Number.isSafeInteger(v) || v < 0) return { ok: false, error: 'Amounts must be zero or more.' };
      shares[m] = v;
      sum += v;
    }
    if (sum !== total) {
      const diff = total - sum;
      return { ok: false, error: diff > 0 ? `₹${(diff / 100).toFixed(2)} still to assign.` : `₹${(-diff / 100).toFixed(2)} over the total.` };
    }
    return { ok: true, shares };
  }
  if (type === 'equal') weights = uniq.map(() => 1);
  else if (type === 'percentage') {
    weights = uniq.map((m) => values[m] ?? 0);
    if (weights.some((w) => !Number.isSafeInteger(w) || w < 0)) return { ok: false, error: 'Percentages must be zero or more.' };
    const sum = weights.reduce((a, b) => a + b, 0);
    if (sum !== 10000) return { ok: false, error: `Percentages add up to ${(sum / 100).toFixed(2)}%, not 100%.` };
  } else if (type === 'shares') {
    weights = uniq.map((m) => values[m] ?? 0);
    if (weights.some((w) => !Number.isSafeInteger(w) || w < 0)) return { ok: false, error: 'Shares must be whole numbers.' };
    if (weights.reduce((a, b) => a + b, 0) <= 0) return { ok: false, error: 'Give at least one share.' };
  } else return { ok: false, error: 'Unknown split type.' };

  const wsum = weights.reduce((a, b) => a + b, 0);
  let assigned = 0;
  uniq.forEach((m, i) => {
    // Integer arithmetic: total * weight fits easily in 2^53 for realistic amounts.
    const s = Math.floor((total * weights[i]) / wsum);
    shares[m] = s;
    assigned += s;
  });
  const leftover = total - assigned;
  const receiver = uniq.includes(payer) ? payer : uniq[0];
  shares[receiver] += leftover;
  return { ok: true, shares };
}

export interface BillItem { name: string; amount: Paise; assignees: string[] }

/**
 * Items are split equally among their assignees; tax, service charge and discount are shared
 * in proportion to each person's item subtotal. Leftover paise go to the payer.
 */
export function computeBillSplits(opts: {
  items: BillItem[]; tax: Paise; service: Paise; discount: Paise; payer: string;
}): SplitResult {
  const { items, tax, service, discount, payer } = opts;
  if (items.length === 0) return { ok: false, error: 'Add at least one item.' };
  const sub: Record<string, number> = {};
  for (const it of items) {
    if (it.assignees.length === 0) return { ok: false, error: `Assign "${it.name || 'item'}" to someone.` };
    if (!Number.isSafeInteger(it.amount) || it.amount < 0) return { ok: false, error: 'Item amounts must be zero or more.' };
    if (it.amount === 0) continue;
    const r = computeSplits({ total: it.amount, payer, type: 'equal', members: it.assignees });
    if (!r.ok) return r;
    for (const [k, v] of Object.entries(r.shares)) sub[k] = (sub[k] ?? 0) + v;
  }
  const people = Object.keys(sub);
  const subtotal = people.reduce((a, k) => a + sub[k], 0);
  const extra = tax + service - discount;
  const total = subtotal + extra;
  if (total <= 0 || subtotal <= 0) return { ok: false, error: 'The bill total must be above ₹0.' };
  const shares: Record<string, number> = {};
  let assigned = 0;
  for (const k of people) {
    // floor toward -infinity works for negative extra (discount larger than charges) too
    const e = Math.floor((extra * sub[k]) / subtotal);
    shares[k] = sub[k] + e;
    assigned += shares[k];
  }
  const receiver = people.includes(payer) ? payer : people[0];
  shares[receiver] += total - assigned;
  return { ok: true, shares };
}
