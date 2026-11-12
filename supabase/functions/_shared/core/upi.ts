// GENERATED from src/core/upi.ts by scripts/sync-shared.mjs. Do not edit.
import { paiseToRupeeString, type Paise } from './money.ts';

const UPI_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,255}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;

export function normalizeUpiId(v: string): string {
  return v.trim().toLowerCase();
}

export function isValidUpiId(v: string): boolean {
  return UPI_ID.test(v.trim());
}

/**
 * upi://pay?pa=<upi id>&pn=<name>&am=<rupees, 2 dp>&cu=INR&tn=<note>
 * The UPI ID is left unencoded (several UPI apps reject "%40"); name and note are percent-encoded.
 */
export function buildUpiLink(o: { upiId: string; name: string; amount: Paise; note: string }): string {
  const pa = normalizeUpiId(o.upiId);
  if (!isValidUpiId(pa)) throw new Error('That UPI ID does not look right.');
  if (!Number.isSafeInteger(o.amount) || o.amount <= 0) throw new Error('Amount must be above ₹0.');
  return `upi://pay?pa=${pa}&pn=${encodeURIComponent(o.name.trim())}&am=${paiseToRupeeString(o.amount)}&cu=INR&tn=${encodeURIComponent(o.note.trim().slice(0, 50))}`;
}
