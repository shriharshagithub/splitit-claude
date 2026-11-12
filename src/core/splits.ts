import { isPaise, MAX_EXPENSE_PAISE, type Paise } from './money';

export type SplitType = 'equal' | 'exact' | 'percentage' | 'shares';

/**
 * value meaning by split type:
 * - equal: ignored (presence means included)
 * - exact: paise
 * - percentage: hundredths of a percent (basis points), 10000 = 100%
 * - shares: whole number of shares
 */
export interface SplitInput {
  userId: string;
  value?: number;
}

export interface SplitRow {
  userId: string;
  amount: Paise;
}

export type SplitResult =
  | { ok: true; splits: SplitRow[] }
  | { ok: false; error: string; allocated?: Paise };

const nonNegInt = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/**
 * Compute per-person amounts. Sum always equals total on success.
 * Rounding remainders (from floor division) go to the payer, per the PRD.
 * Mirrored exactly by the database function public.compute_splits.
 */
export function computeSplits(total: Paise, type: SplitType, participants: SplitInput[], payerId: string): SplitResult {
  if (!isPaise(total) || total <= 0) return { ok: false, error: 'Enter an amount greater than ₹0.00.' };
  if (total > MAX_EXPENSE_PAISE) return { ok: false, error: 'That amount is too large for one expense.' };
  if (participants.length === 0) return { ok: false, error: 'Choose at least one person to split with.' };
  const ids = new Set(participants.map((p) => p.userId));
  if (ids.size !== participants.length) return { ok: false, error: 'A person appears twice in the split.' };

  let amounts: number[];
  switch (type) {
    case 'equal': {
      const each = Math.floor(total / participants.length);
      amounts = participants.map(() => each);
      break;
    }
    case 'exact': {
      if (!participants.every((p) => nonNegInt(p.value))) return { ok: false, error: 'Enter an amount for each person.' };
      amounts = participants.map((p) => p.value as number);
      const sum = amounts.reduce((a, b) => a + b, 0);
      if (sum !== total) return { ok: false, error: 'Splits must add up to the total.', allocated: sum };
      break;
    }
    case 'percentage': {
      if (!participants.every((p) => nonNegInt(p.value))) return { ok: false, error: 'Enter a percentage for each person.' };
      const bp = participants.reduce((a, p) => a + (p.value as number), 0);
      if (bp !== 10000) return { ok: false, error: 'Percentages must add up to 100%.', allocated: bp };
      amounts = participants.map((p) => Math.floor((total * (p.value as number)) / 10000));
      break;
    }
    case 'shares': {
      if (!participants.every((p) => nonNegInt(p.value))) return { ok: false, error: 'Shares must be whole numbers.' };
      const S = participants.reduce((a, p) => a + (p.value as number), 0);
      if (S <= 0) return { ok: false, error: 'Give at least one person a share.' };
      amounts = participants.map((p) => Math.floor((total * (p.value as number)) / S));
      break;
    }
    default:
      return { ok: false, error: 'Unknown split type.' };
  }

  const rows = new Map<string, number>();
  participants.forEach((p, i) => rows.set(p.userId, amounts[i]));
  const remainder = total - amounts.reduce((a, b) => a + b, 0);
  if (remainder !== 0) rows.set(payerId, (rows.get(payerId) ?? 0) + remainder);

  const splits = [...rows.entries()].filter(([, a]) => a > 0).map(([userId, amount]) => ({ userId, amount }));
  return { ok: true, splits };
}

export interface ReceiptItemInput {
  amount: Paise;
  assignees: string[];
}

/**
 * Bill-scan splitting: each item is divided equally among its assignees; `extras`
 * (tax + service charge, minus any discount) is divided in proportion to each
 * person's item subtotal. Every rounding remainder goes to the payer.
 */
export function computeReceiptSplits(items: ReceiptItemInput[], extras: Paise, payerId: string): SplitResult {
  if (items.length === 0) return { ok: false, error: 'Add at least one item.' };
  if (!items.every((i) => nonNegInt(i.amount))) return { ok: false, error: 'Each item needs an amount.' };
  if (items.some((i) => i.assignees.length === 0)) return { ok: false, error: 'Assign every item to at least one person.' };
  if (!isPaise(extras)) return { ok: false, error: 'Tax and service charge must be amounts.' };
  const itemsTotal = items.reduce((a, i) => a + i.amount, 0);
  const total = itemsTotal + extras;
  if (itemsTotal <= 0 || total <= 0) return { ok: false, error: 'The bill total must be more than ₹0.00.' };

  const sub = new Map<string, number>();
  for (const it of items) {
    const each = Math.floor(it.amount / it.assignees.length);
    for (const u of new Set(it.assignees)) sub.set(u, (sub.get(u) ?? 0) + each);
  }
  const rows = new Map<string, number>();
  for (const [u, s] of sub) rows.set(u, s + Math.floor((extras * s) / itemsTotal));
  const allocated = [...rows.values()].reduce((a, b) => a + b, 0);
  rows.set(payerId, (rows.get(payerId) ?? 0) + (total - allocated));
  const splits = [...rows.entries()].filter(([, a]) => a !== 0).map(([userId, amount]) => ({ userId, amount }));
  if (splits.some((s) => s.amount < 0)) return { ok: false, error: 'The discount is larger than one person’s share.' };
  return { ok: true, splits };
}
