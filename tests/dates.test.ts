import { describe, expect, it } from 'vitest';
import { addDays, formatDate, localToday } from '../src/core';

describe('dates', () => {
  it('uses the local calendar day, not UTC', () => {
    // 00:30 IST on 12 Nov is still 11 Nov in UTC; the expense date must be 12 Nov.
    const justAfterMidnightLocal = new Date(2026, 10, 12, 0, 30);
    expect(localToday(justAfterMidnightLocal)).toBe('2026-11-12');
  });
  it('adds days across month ends', () => {
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('formats for display', () => {
    expect(formatDate('2026-11-12')).toBe('12 Nov 2026');
  });
});
