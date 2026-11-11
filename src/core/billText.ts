import type { Paise } from './money';

export interface ParsedBill {
  items: { name: string; amount: Paise }[];
  tax: Paise;
  serviceCharge: Paise;
  discount: Paise;
  printedTotal: Paise | null;
}

const AMOUNT_AT_END = /(?:₹|rs\.?|inr)?\s*((?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?)\s*$/i;
const TAX = /\b(c\s*gst|s\s*gst|i\s*gst|u\s*gst|gst|vat|cess|tax)\b/i;
const SERVICE = /\b(service\s*(charge|chg|chrg|tax)?|s\.?\s*c\.?)\b/i;
const DISCOUNT = /\b(discount|disc\.?|less)\b/i;
const TOTAL = /\b(grand\s*total|net\s*(amount|amt|payable|total)|total\s*(amount|amt|payable|due)?|amount\s*payable|bill\s*amount)\b/i;
const SKIP = /\b(sub\s*-?\s*total|round(ed)?\s*off|cash|change|tendered|card|upi|paytm|balance|bill\s*no|invoice|table|tbl|date|time|gstin|fssai|cover|pax|qty|rate|amount|thank|visit|phone|ph\.?|mob|www|kot|steward|waiter|cashier|token)\b/i;

function toPaise(s: string): Paise {
  const clean = s.replace(/,/g, '');
  const [r, f = ''] = clean.split('.');
  return Number(r) * 100 + Number(f.padEnd(2, '0').slice(0, 2));
}

/**
 * Turn OCR text from a restaurant bill into line items, tax and service charge.
 * Heuristic: a line that ends in an amount is a candidate; keyword lines become tax,
 * service, discount or the printed total; everything else with a name is an item.
 * The user reviews and corrects the result before anything is saved.
 */
export function parseBillText(text: string): ParsedBill {
  const out: ParsedBill = { items: [], tax: 0, serviceCharge: 0, discount: 0, printedTotal: null };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (line.length < 3) continue;
    const m = AMOUNT_AT_END.exec(line);
    if (!m) continue;
    const amount = toPaise(m[1]);
    const label = line.slice(0, m.index).trim();
    if (amount <= 0) continue;
    if (SERVICE.test(label) && !/\bgst\b/i.test(label.replace(/service/i, ''))) {
      out.serviceCharge += amount;
      continue;
    }
    if (TAX.test(label)) {
      out.tax += amount;
      continue;
    }
    if (DISCOUNT.test(label)) {
      out.discount += amount;
      continue;
    }
    if (TOTAL.test(label) && !/sub/i.test(label)) {
      out.printedTotal = amount;
      continue;
    }
    if (SKIP.test(label)) continue;
    // Drop trailing quantity / rate columns: "Garlic Naan 4 60.00" -> "Garlic Naan"
    const name = label
      .replace(/(\s+(x\s*)?\d+(\.\d{1,2})?)+\s*$/i, '')
      .replace(/^[\d.\-)\s]+/, '')
      .replace(/[*:|]+$/g, '')
      .trim();
    if (!/[a-z]{2,}/i.test(name)) continue;
    out.items.push({ name, amount });
  }
  return out;
}
