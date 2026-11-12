/** All money is integer paise. Rupees exist only for display and the UPI link. */
export type Paise = number;

export function assertPaise(v: number): asserts v is Paise {
  if (!Number.isSafeInteger(v)) throw new Error('amount must be a whole number of paise');
}

/** "1234.5" | "1,234.50" | "₹ 12" -> paise, without floating point. Returns null when not a valid amount. */
export function parseRupees(input: string): Paise | null {
  const s = input.replace(/[₹,\s]/g, '');
  const m = /^(\d{1,9})(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  const frac = (m[2] ?? '').padEnd(2, '0');
  return Number(m[1]) * 100 + Number(frac);
}

/** 12345 -> "123.45" (UPI `am` format: rupees with exactly two decimals). */
export function paiseToRupeeString(p: Paise): string {
  assertPaise(p);
  const neg = p < 0;
  const a = Math.abs(p);
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

/** Indian digit grouping: 12345678 -> "1,23,45,678". */
function groupIndian(n: string): string {
  if (n.length <= 3) return n;
  const last3 = n.slice(-3);
  const rest = n.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

/** 12345678 -> "₹1,23,456.78". Negative values keep the sign: "-₹4.50". */
export function formatINR(p: Paise): string {
  assertPaise(p);
  const a = Math.abs(p);
  const body = `₹${groupIndian(String(Math.floor(a / 100)))}.${String(a % 100).padStart(2, '0')}`;
  return p < 0 ? `-${body}` : body;
}

/** Plain-language direction for a net balance from the viewer's side. */
export function describeNet(net: Paise): { words: string; direction: 'owe' | 'owed' | 'settled' } {
  if (net > 0) return { words: `you are owed ${formatINR(net)}`, direction: 'owed' };
  if (net < 0) return { words: `you owe ${formatINR(-net)}`, direction: 'owe' };
  return { words: 'you are settled up', direction: 'settled' };
}
