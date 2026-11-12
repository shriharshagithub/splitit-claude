import { describe, expect, it } from 'vitest';
import {
  addDays, applyTransfers, buildUpiLink, computeBillSplits, computeSplits, describeNet, formatDate, formatDateTimeIST,
  formatINR, isValidUpiId, normalizeIndianPhone, paiseToRupeeString, parseBillText, parseRupees, simplifyDebts, type Transfer,
} from '../src/core';

// Small deterministic random generator so failures are reproducible.
function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

describe('money', () => {
  it('formats with Indian grouping and two decimals', () => {
    expect(formatINR(0)).toBe('₹0.00');
    expect(formatINR(45000)).toBe('₹450.00');
    expect(formatINR(123456)).toBe('₹1,234.56');
    expect(formatINR(1234567890)).toBe('₹1,23,45,678.90');
    expect(formatINR(-450)).toBe('-₹4.50');
  });
  it('parses rupees without floating point', () => {
    expect(parseRupees('450')).toBe(45000);
    expect(parseRupees('0.1')).toBe(10);
    expect(parseRupees('1,234.5')).toBe(123450);
    expect(parseRupees('₹ 19.99')).toBe(1999);
    expect(parseRupees('1.234')).toBeNull();
    expect(parseRupees('abc')).toBeNull();
    expect(parseRupees('')).toBeNull();
  });
  it('writes balance direction in words', () => {
    expect(describeNet(45000).words).toBe('you are owed ₹450.00');
    expect(describeNet(-45000).words).toBe('you owe ₹450.00');
    expect(describeNet(0).words).toBe('you are settled up');
  });
  it('UPI amount format', () => {
    expect(paiseToRupeeString(5)).toBe('0.05');
    expect(paiseToRupeeString(45000)).toBe('450.00');
  });
});

describe('splits', () => {
  it('equal: leftover paise go to the payer', () => {
    const r = computeSplits({ total: 10000, payer: 'b', type: 'equal', members: ['a', 'b', 'c'] });
    expect(r).toEqual({ ok: true, shares: { a: 3333, b: 3334, c: 3333 } });
  });
  it('equal: payer outside the split -> first member gets leftover', () => {
    const r = computeSplits({ total: 100, payer: 'z', type: 'equal', members: ['a', 'b', 'c'] });
    expect(r).toEqual({ ok: true, shares: { a: 34, b: 33, c: 33 } });
  });
  it('exact must add up', () => {
    expect(computeSplits({ total: 1000, payer: 'a', type: 'exact', members: ['a', 'b'], values: { a: 400, b: 600 } }).ok).toBe(true);
    const bad = computeSplits({ total: 1000, payer: 'a', type: 'exact', members: ['a', 'b'], values: { a: 400, b: 500 } });
    expect(bad).toEqual({ ok: false, error: '₹1.00 still to assign.' });
  });
  it('percentages in basis points must total 100%', () => {
    const r = computeSplits({ total: 99999, payer: 'a', type: 'percentage', members: ['a', 'b', 'c'], values: { a: 5000, b: 2500, c: 2500 } });
    expect(r).toEqual({ ok: true, shares: { a: 50001, b: 24999, c: 24999 } });
    expect(computeSplits({ total: 100, payer: 'a', type: 'percentage', members: ['a'], values: { a: 9000 } }).ok).toBe(false);
  });
  it('shares', () => {
    const r = computeSplits({ total: 70000, payer: 'a', type: 'shares', members: ['a', 'b'], values: { a: 2, b: 5 } });
    expect(r).toEqual({ ok: true, shares: { a: 20000, b: 50000 } });
  });
  it('rejects zero, negative and fractional totals', () => {
    for (const total of [0, -5, 10.5]) expect(computeSplits({ total, payer: 'a', type: 'equal', members: ['a'] }).ok).toBe(false);
  });
  it('random: every successful split adds up exactly to the total', () => {
    const r = rng(42);
    for (let i = 0; i < 5000; i++) {
      const n = 1 + Math.floor(r() * 12);
      const members = Array.from({ length: n }, (_, k) => `m${k}`);
      const total = 1 + Math.floor(r() * 10_000_000);
      const payer = r() < 0.8 ? members[Math.floor(r() * n)] : 'outsider';
      const type = (['equal', 'percentage', 'shares', 'exact'] as const)[i % 4];
      const values: Record<string, number> = {};
      if (type === 'percentage') {
        let left = 10000;
        members.forEach((m, k) => { const v = k === n - 1 ? left : Math.floor(r() * left); values[m] = v; left -= v; });
      } else if (type === 'shares') members.forEach((m) => (values[m] = 1 + Math.floor(r() * 9)));
      else if (type === 'exact') {
        let left = total;
        members.forEach((m, k) => { const v = k === n - 1 ? left : Math.floor(r() * left); values[m] = v; left -= v; });
      }
      const res = computeSplits({ total, payer, type, members, values });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(sum(res.shares)).toBe(total);
        Object.values(res.shares).forEach((v) => expect(Number.isInteger(v) && v >= 0).toBe(true));
      }
    }
  });
});

describe('bill splits', () => {
  it('shares tax and service in proportion to item subtotals', () => {
    const r = computeBillSplits({
      items: [{ name: 'Biryani', amount: 30000, assignees: ['a'] }, { name: 'Naan', amount: 10000, assignees: ['a', 'b'] }],
      tax: 2000, service: 4000, discount: 0, payer: 'a',
    });
    // subtotals a=35000 b=5000; extra 6000 -> a 5250, b 750
    expect(r).toEqual({ ok: true, shares: { a: 40250, b: 5750 } });
  });
  it('discount reduces shares, total is exact', () => {
    const r = computeBillSplits({
      items: [{ name: 'x', amount: 333, assignees: ['a', 'b', 'c'] }], tax: 17, service: 0, discount: 50, payer: 'c',
    });
    expect(r.ok && sum(r.shares)).toBe(300);
  });
  it('random: bill splits always add up', () => {
    const r = rng(7);
    for (let i = 0; i < 2000; i++) {
      const people = ['a', 'b', 'c', 'd', 'e'].slice(0, 1 + Math.floor(r() * 5));
      const items = Array.from({ length: 1 + Math.floor(r() * 8) }, () => ({
        name: 'i', amount: 1 + Math.floor(r() * 100000), assignees: people.filter(() => r() < 0.6).concat(people[0]),
      }));
      const tax = Math.floor(r() * 5000), service = Math.floor(r() * 5000), discount = Math.floor(r() * 3000);
      const res = computeBillSplits({ items, tax, service, discount, payer: people[Math.floor(r() * people.length)] });
      const subtotal = items.reduce((a, b) => a + b.amount, 0);
      expect(res.ok).toBe(true);
      if (res.ok) expect(sum(res.shares)).toBe(subtotal + tax + service - discount);
    }
  });
  it('requires every item to be assigned', () => {
    expect(computeBillSplits({ items: [{ name: 'Tea', amount: 100, assignees: [] }], tax: 0, service: 0, discount: 0, payer: 'a' }).ok).toBe(false);
  });
});

function bruteMin(nets: Record<string, number>): number {
  // Minimum payments by trying every way to settle the first non-zero person (exponential, small n only).
  const vals = Object.values(nets).filter((v) => v !== 0);
  const go = (v: number[]): number => {
    const i = v.findIndex((x) => x !== 0);
    if (i < 0) return 0;
    let best = Infinity;
    for (let j = i + 1; j < v.length; j++) {
      if (v[j] !== 0 && Math.sign(v[j]) !== Math.sign(v[i])) {
        const w = v.slice();
        w[j] += w[i];
        w[i] = 0;
        best = Math.min(best, 1 + go(w));
      }
    }
    return best;
  };
  return go(vals);
}

describe('fewest payments', () => {
  it('A owes B 100, B owes C 100 -> A pays C 100', () => {
    expect(simplifyDebts({ A: -10000, B: 0, C: 10000 })).toEqual([{ from: 'A', to: 'C', amount: 10000 }]);
  });
  it('beats greedy when pairs cancel exactly', () => {
    // greedy (largest first) needs 4 payments here; the optimum is 3
    const nets = { a: -600, b: -500, c: -400, d: 700, e: 400, f: 400 };
    const t = simplifyDebts(nets);
    expect(t.length).toBe(bruteMin(nets));
    expect(Object.values(applyTransfers(nets, t)).every((v) => v === 0)).toBe(true);
  });
  it('random: settles everyone, with the proven minimum number of payments', () => {
    const r = rng(99);
    for (let i = 0; i < 300; i++) {
      const n = 2 + Math.floor(r() * 6);
      const nets: Record<string, number> = {};
      let s = 0;
      for (let k = 0; k < n - 1; k++) { const v = Math.floor((r() - 0.5) * 20) * 100; nets[`p${k}`] = v; s += v; }
      nets[`p${n - 1}`] = -s;
      const t: Transfer[] = simplifyDebts(nets);
      expect(Object.values(applyTransfers(nets, t)).every((v) => v === 0)).toBe(true);
      expect(t.every((x) => x.amount > 0)).toBe(true);
      expect(t.length).toBe(bruteMin(nets));
    }
  });
  it('16 people runs exactly and fast; 17+ uses greedy and still settles', () => {
    const mk = (n: number) => {
      const nets: Record<string, number> = {};
      let s = 0;
      for (let k = 0; k < n - 1; k++) { const v = ((k * 7919) % 2000) - 1000 || 1; nets[`p${k}`] = v; s += v; }
      nets[`p${n - 1}`] = -s;
      return nets;
    };
    for (const n of [16, 17, 40]) {
      const nets = mk(n);
      const t0 = Date.now();
      const t = simplifyDebts(nets);
      expect(Date.now() - t0).toBeLessThan(3000);
      expect(Object.values(applyTransfers(nets, t)).every((v) => v === 0)).toBe(true);
      expect(t.length).toBeLessThanOrEqual(n - 1);
    }
  });
  it('refuses unbalanced input', () => {
    expect(() => simplifyDebts({ a: 1 })).toThrow();
  });
});

describe('UPI link', () => {
  it('builds the standard link: ID unencoded, rupees 2dp, name and note encoded', () => {
    expect(buildUpiLink({ upiId: 'Ravi.K@okhdfcbank', name: 'Ravi Kumar', amount: 45050, note: 'SplitIt Goa Trip' }))
      .toBe('upi://pay?pa=ravi.k@okhdfcbank&pn=Ravi%20Kumar&am=450.50&cu=INR&tn=SplitIt%20Goa%20Trip');
    expect(buildUpiLink({ upiId: 'a1@ybl', name: 'A & B', amount: 1, note: 'Flat #402' }))
      .toBe('upi://pay?pa=a1@ybl&pn=A%20%26%20B&am=0.01&cu=INR&tn=Flat%20%23402');
  });
  it('validates UPI IDs and amounts', () => {
    expect(isValidUpiId('9876543210@paytm')).toBe(true);
    expect(isValidUpiId('no-at-sign')).toBe(false);
    expect(isValidUpiId('x@1bank')).toBe(false);
    expect(() => buildUpiLink({ upiId: 'bad', name: 'x', amount: 100, note: '' })).toThrow();
    expect(() => buildUpiLink({ upiId: 'a@ybl', name: 'x', amount: 0, note: '' })).toThrow();
  });
});

describe('bill text', () => {
  it('reads a typical Indian restaurant bill', () => {
    const text = `THE SPICE ROUTE
GSTIN: 29ABCDE1234F1Z5
Bill No: 1042   Table: 7
Date: 03/11/2026
Item            Qty   Amount
Paneer Tikka     1    320.00
Butter Naan      4    240.00
Dal Makhani      1    280.00
Masala Chaas     2    120.00
Sub Total             960.00
Service Charge 5%      48.00
CGST @2.5%             24.00
SGST @2.5%             24.00
Discount               50.00
Grand Total         1,006.00
Thank you! Visit again`;
    const b = parseBillText(text);
    expect(b.items).toEqual([
      { name: 'Paneer Tikka', amount: 32000 },
      { name: 'Butter Naan', amount: 24000 },
      { name: 'Dal Makhani', amount: 28000 },
      { name: 'Masala Chaas', amount: 12000 },
    ]);
    expect(b.service).toBe(4800);
    expect(b.tax).toBe(4800);
    expect(b.discount).toBe(5000);
    expect(b.total).toBe(100600);
  });
  it('returns nothing useful for unreadable text', () => {
    expect(parseBillText('blurry ### ???').items).toEqual([]);
  });
});

describe('dates and phones', () => {
  it('formats dates as "3 Nov 2026" and steps across month ends', () => {
    expect(formatDate('2026-11-03')).toBe('3 Nov 2026');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('shows timestamps in IST', () => {
    expect(formatDateTimeIST('2026-11-03T03:30:00Z')).toBe('3 Nov 2026, 9:00 am IST');
    expect(formatDateTimeIST('2026-11-03T20:00:00Z')).toBe('4 Nov 2026, 1:30 am IST');
  });
  it('normalises Indian mobile numbers', () => {
    expect(normalizeIndianPhone('98860 54321')).toBe('919886054321');
    expect(normalizeIndianPhone('+91-98860-54321')).toBe('919886054321');
    expect(normalizeIndianPhone('09886054321')).toBe('919886054321');
    expect(normalizeIndianPhone('12345')).toBeNull();
    expect(normalizeIndianPhone('5886054321')).toBeNull();
  });
});
