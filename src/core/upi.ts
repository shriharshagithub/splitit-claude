import { paiseToRupeeString, type Paise } from './money';

const UPI_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,255}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;

export function isValidUpiId(v: string): boolean {
  return UPI_ID.test(v.trim());
}

/**
 * upi://pay?pa=<id>&pn=<name>&am=<rupees 2dp>&cu=INR&tn=SplitIt <group>
 * `pa` is left unencoded (some UPI apps reject %40); the rest is percent-encoded.
 */
export function buildUpiLink(opts: { upiId: string; name: string; amount: Paise; groupName: string }): string {
  const pa = opts.upiId.trim();
  if (!isValidUpiId(pa)) throw new Error('invalid UPI ID');
  if (opts.amount <= 0) throw new Error('amount must be positive');
  const q = [
    `pa=${pa}`,
    `pn=${encodeURIComponent(opts.name)}`,
    `am=${paiseToRupeeString(opts.amount)}`,
    'cu=INR',
    `tn=${encodeURIComponent(`SplitIt ${opts.groupName}`.slice(0, 80))}`,
  ];
  return `upi://pay?${q.join('&')}`;
}
