import type { Paise } from './money';

export interface ParsedBill {
  items: { name: string; amount: Paise }[];
  tax: Paise;
  service: Paise;
  discount: Paise;
  /** Printed total if found, else null. */
  total: Paise | null;
}

const AMOUNT_AT_END = /(-?\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|-?\d+(?:\.\d{1,2})?)\s*(?:\/-)?\s*$/;

function toPaise(s: string): Paise {
  const clean = s.replace(/,/g, '');
  const neg = clean.startsWith('-');
  const [r, f = ''] = clean.replace('-', '').split('.');
  const v = Number(r) * 100 + Number(f.padEnd(2, '0'));
  return neg ? -v : v;
}

const SKIP = /\b(gstin|fssai|invoice|bill\s*no|table|tbl|cover|pax|date|time|cashier|server|steward|waiter|phone|ph\.?|mob|tel|thank|visit|order\s*no|kot|token|qty|rate|amount\s*$|item|description|hsn|round(ed)?\s*off|change|paid|cash|card|upi|balance|tender)\b/i;
const TOTAL = /\b(grand\s*total|net\s*(amount|total|payable)|total\s*(amount|payable|due)?|amount\s*payable|bill\s*amount|to\s*pay)\b/i;
const SUBTOTAL = /\b(sub\s*-?\s*total|item\s*total|food\s*total|gross)\b/i;
const TAX = /\b(c\s*gst|s\s*gst|i\s*gst|u\s*gst|gst|vat|tax|cess)\b/i;
const SERVICE = /\b(service\s*(charge|chg|tax)?|s\.?\s*c\.?)\b/i;
const DISCOUNT = /\b(discount|disc\.?|less|offer|promo|coupon)\b/i;

/** Reads OCR text from a restaurant bill. Best effort: everything stays editable on screen. */
export function parseBillText(text: string): ParsedBill {
  const out: ParsedBill = { items: [], tax: 0, service: 0, discount: 0, total: null };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[₹]|rs\.?|inr/gi, ' ').replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const m = AMOUNT_AT_END.exec(line);
    if (!m) continue;
    const amount = Math.abs(toPaise(m[1]));
    const label = line.slice(0, m.index).replace(/[:\-–@x*]+\s*$/i, '').trim();
    // Labels that are only numbers (e.g. "2 120.00" quantity rows) have no name to keep.
    if (!/[a-z]/i.test(label)) continue;
    if (SUBTOTAL.test(label)) continue;
    if (SERVICE.test(label) && !/tax/i.test(label.replace(/service\s*tax/i, ''))) { out.service += amount; continue; }
    if (DISCOUNT.test(label)) { out.discount += amount; continue; }
    if (TAX.test(label)) { out.tax += amount; continue; }
    if (TOTAL.test(label)) { out.total = amount; continue; }
    if (SKIP.test(label)) continue;
    if (amount === 0) continue;
    // Drop trailing quantity/rate columns from the name: "Paneer Tikka 2 180.00" -> "Paneer Tikka"
    const name = label.replace(/(\s+\d+(\.\d+)?)+$/, '').replace(/^\d+[.)]\s*/, '').trim();
    if (name.length < 2) continue;
    out.items.push({ name, amount });
  }
  return out;
}
