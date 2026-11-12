/** All money is integer paise. Rupees appear only in formatting and the UPI link. */
export type Paise = number;

export const MAX_EXPENSE_PAISE = 100_000_000_00; // ₹10,00,00,000.00

export function isPaise(v: unknown): v is Paise {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

/** Indian digit grouping: 1,00,00,000 */
function groupIndian(rupees: string): string {
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3);
  return rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3;
}

/** 123450 -> "₹1,234.50"; negative values get a leading minus. */
export function formatINR(paise: Paise): string {
  if (!isPaise(paise)) throw new Error('formatINR expects integer paise');
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100).toString();
  const p = (abs % 100).toString().padStart(2, '0');
  return `${sign}₹${groupIndian(rupees)}.${p}`;
}

/** 123450 -> "1234.50" (UPI `am` parameter). */
export function paiseToRupeeString(paise: Paise): string {
  if (!isPaise(paise) || paise < 0) throw new Error('expected non-negative integer paise');
  return `${Math.floor(paise / 100)}.${(paise % 100).toString().padStart(2, '0')}`;
}

/**
 * Parse user input such as "₹1,234.5", "1234", "1,00,000.00" into paise.
 * Returns null for anything that is not a plain non-negative amount with at most 2 decimals.
 * Never goes through floating point.
 */
export function parseRupees(input: string): Paise | null {
  const s = input.trim().replace(/^₹\s*/, '').replace(/^(rs\.?|inr)\s*/i, '').replace(/,/g, '');
  const m = /^(\d{1,12})(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  const rupees = Number(m[1]);
  const frac = (m[2] ?? '').padEnd(2, '0');
  const value = rupees * 100 + Number(frac);
  return Number.isSafeInteger(value) ? value : null;
}
