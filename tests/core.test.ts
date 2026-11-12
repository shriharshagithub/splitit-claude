import { describe, expect, it } from 'vitest';
import {
  buildUpiLink, computeReceiptSplits, computeSplits, formatINR, parseBillText, parseRupees, simplifyDebts, type Nets,
} from '../src/core';

describe('money', () => {
  it('formats INR with Indian grouping', () => {
    expect(formatINR(123450)).toBe('₹1,234.50');
    expect(formatINR(0)).toBe('₹0.00');
    expect(formatINR(5)).toBe('₹0.05');
    expect(formatINR(10000000_00)).toBe('₹1,00,00,000.00');
    expect(formatINR(-120000)).toBe('-₹1,200.00');
  });
  it('parses rupee input without floats', () => {
    expect(parseRupees('₹1,234.5')).toBe(123450);
    expect(parseRupees('0.1')).toBe(10);
    expect(parseRupees('1,00,000')).toBe(10000000);
    expect(parseRupees('12.345')).toBeNull();
    expect(parseRupees('-5')).toBeNull();
    expect(parseRupees('abc')).toBeNull();
  });
});

describe('computeSplits', () => {
  const p = (...ids: string[]) => ids.map((userId) => ({ userId }));
  it('equal: remainder goes to payer', () => {
    const r = computeSplits(100, 'equal', p('a', 'b', 'c'), 'b');
    expect(r).toEqual({ ok: true, splits: [{ userId: 'a', amount: 33 }, { userId: 'b', amount: 34 }, { userId: 'c', amount: 33 }] });
  });
  it('equal: payer not in split still absorbs remainder', () => {
    const r = computeSplits(100, 'equal', p('a', 'b', 'c'), 'z');
    if (!r.ok) throw new Error();
    expect(r.splits.find((s) => s.userId === 'z')?.amount).toBe(1);
    expect(r.splits.reduce((a, s) => a + s.amount, 0)).toBe(100);
  });
  it('exact must sum to total', () => {
    expect(computeSplits(1000, 'exact', [{ userId: 'a', value: 400 }, { userId: 'b', value: 500 }], 'a')).toMatchObject({ ok: false, allocated: 900 });
    expect(computeSplits(1000, 'exact', [{ userId: 'a', value: 400 }, { userId: 'b', value: 600 }], 'a').ok).toBe(true);
  });
  it('percentage in basis points', () => {
    const r = computeSplits(425000, 'percentage', [{ userId: 'a', value: 3333 }, { userId: 'b', value: 3333 }, { userId: 'c', value: 3334 }], 'c');
    if (!r.ok) throw new Error(r.error);
    expect(r.splits.reduce((a, s) => a + s.amount, 0)).toBe(425000);
    expect(computeSplits(1000, 'percentage', [{ userId: 'a', value: 5000 }], 'a').ok).toBe(false);
  });
  it('shares', () => {
    const r = computeSplits(425000, 'shares', [{ userId: 'a', value: 1 }, { userId: 'b', value: 2 }, { userId: 'c', value: 0 }], 'b');
    if (!r.ok) throw new Error(r.error);
    expect(r.splits).toEqual([{ userId: 'a', amount: 141666 }, { userId: 'b', amount: 283334 }]);
  });
  it('sum always equals total across random inputs', () => {
    for (let t = 0; t < 2000; t++) {
      const total = 1 + Math.floor(Math.random() * 1_000_000);
      const n = 1 + Math.floor(Math.random() * 8);
      const ids = Array.from({ length: n }, (_, i) => `u${i}`);
      const shares = ids.map((userId) => ({ userId, value: Math.floor(Math.random() * 5) + (userId === 'u0' ? 1 : 0) }));
      for (const r of [computeSplits(total, 'equal', p(...ids), 'u1'), computeSplits(total, 'shares', shares, 'u0')]) {
        if (!r.ok) throw new Error(r.error);
        expect(r.splits.reduce((a, s) => a + s.amount, 0)).toBe(total);
      }
    }
  });
  it('rejects bad input', () => {
    expect(computeSplits(0, 'equal', p('a'), 'a').ok).toBe(false);
    expect(computeSplits(1.5, 'equal', p('a'), 'a').ok).toBe(false);
    expect(computeSplits(100, 'equal', p('a', 'a'), 'a').ok).toBe(false);
  });
});

describe('computeReceiptSplits', () => {
  it('distributes tax and service by item subtotal', () => {
    const items = [
      { amount: 42000, assignees: ['you', 'ravi'] },
      { amount: 24000, assignees: ['you', 'ravi', 'ananya'] },
      { amount: 36000, assignees: ['ananya'] },
      { amount: 27000, assignees: ['you', 'ravi', 'ananya'] },
    ];
    const r = computeReceiptSplits(items, 6450 + 12900, 'you');
    if (!r.ok) throw new Error(r.error);
    const m = Object.fromEntries(r.splits.map((s) => [s.userId, s.amount]));
    expect(m).toEqual({ you: 43700, ravi: 43700, ananya: 60950 });
    expect(m.you + m.ravi + m.ananya).toBe(148350);
  });
  it('requires every item assigned', () => {
    expect(computeReceiptSplits([{ amount: 100, assignees: [] }], 0, 'a').ok).toBe(false);
  });
});

function apply(nets: Nets, ts: { from: string; to: string; amount: number }[]) {
  const n = { ...nets };
  for (const t of ts) {
    n[t.from] += t.amount;
    n[t.to] -= t.amount;
  }
  return Object.values(n).every((v) => v === 0);
}

function bruteMin(values: number[]): number {
  // minimum transfers = n - max zero-sum partition count (exhaustive over set partitions via memo)
  const n = values.length;
  const memo = new Map<number, number>();
  const sumOf = (m: number) => values.reduce((a, v, i) => a + (m & (1 << i) ? v : 0), 0);
  const best = (m: number): number => {
    if (m === 0) return 0;
    if (memo.has(m)) return memo.get(m)!;
    const low = m & -m;
    let b = -Infinity;
    for (let s = m; s; s = (s - 1) & m) {
      if (s & low && sumOf(s) === 0) b = Math.max(b, 1 + best(m ^ s));
    }
    memo.set(m, b);
    return b;
  };
  return n - best((1 << n) - 1);
}

describe('simplifyDebts', () => {
  it('chains collapse: A owes B 100, B owes C 100 => A pays C 100', () => {
    expect(simplifyDebts({ A: -100, B: 0, C: 100 })).toEqual([{ from: 'A', to: 'C', amount: 100 }]);
  });
  it('finds disjoint pairs (greedy would use 3 transfers here)', () => {
    const nets = { a: -5, b: -3, c: 3, d: 5 };
    const t = simplifyDebts(nets);
    expect(apply(nets, t)).toBe(true);
    expect(t).toHaveLength(2);
  });
  it('is minimal and correct on random groups', () => {
    for (let k = 0; k < 400; k++) {
      const n = 2 + Math.floor(Math.random() * 7);
      const vals = Array.from({ length: n - 1 }, () => (Math.floor(Math.random() * 9) - 4) * 100);
      vals.push(-vals.reduce((a, b) => a + b, 0));
      const nets: Nets = Object.fromEntries(vals.map((v, i) => [`u${i}`, v]));
      const t = simplifyDebts(nets);
      expect(apply(nets, t)).toBe(true);
      expect(t.every((x) => x.amount > 0)).toBe(true);
      expect(t.length).toBe(bruteMin(vals.filter((v) => v !== 0)));
    }
  });
  it('rejects unbalanced input', () => {
    expect(() => simplifyDebts({ a: 1 })).toThrow();
  });
});

describe('UPI link', () => {
  it('builds the PRD format', () => {
    expect(buildUpiLink({ upiId: 'ravi.kumar@okhdfc', name: 'Ravi Kumar', amount: 45000, groupName: 'Goa Trip' }))
      .toBe('upi://pay?pa=ravi.kumar@okhdfc&pn=Ravi%20Kumar&am=450.00&cu=INR&tn=SplitIt%20Goa%20Trip');
  });
  it('rejects bad UPI IDs', () => {
    expect(() => buildUpiLink({ upiId: 'not-an-id', name: 'x', amount: 1, groupName: 'g' })).toThrow();
  });
});

describe('parseBillText', () => {
  it('reads a typical Indian restaurant bill', () => {
    const text = `CAFE MONDEGAR
GSTIN 27AAACC1234F1Z5
Bill No: 4521   Table 7
Date 12/11/2026  Time 21:42
Item           Qty  Rate   Amount
Butter Chicken  1  420.00  420.00
Garlic Naan     4   60.00  240.00
Paneer Tikka    1  360.00  360.00
Fresh Lime Soda x3       270.00
Sub Total               1,290.00
Service Charge 10%        129.00
CGST @2.5%                 32.25
SGST @2.5%                 32.25
Round Off                   0.50
Grand Total             1,484.00
Thank you, visit again`;
    const r = parseBillText(text);
    expect(r.items).toEqual([
      { name: 'Butter Chicken', amount: 42000 },
      { name: 'Garlic Naan', amount: 24000 },
      { name: 'Paneer Tikka', amount: 36000 },
      { name: 'Fresh Lime Soda', amount: 27000 },
    ]);
    expect(r.tax).toBe(6450);
    expect(r.serviceCharge).toBe(12900);
    expect(r.printedTotal).toBe(148400);
  });
  it('returns nothing for unreadable text', () => {
    expect(parseBillText('blurry\n###').items).toEqual([]);
  });
});
