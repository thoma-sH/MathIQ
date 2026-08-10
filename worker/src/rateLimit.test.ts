import { describe, it, expect } from 'vitest';
import { nextMidnightUtc, nextMonthStartUtc } from './rateLimit';

// Both helpers take an injectable date, so these run without touching the
// system clock. They decide when a user's quota comes back, so an off-by-one
// month or a year that fails to roll over is a directly user-visible bug.

describe('nextMidnightUtc', () => {
  it('rolls to the next day from the last millisecond of the day', () => {
    expect(nextMidnightUtc(new Date('2026-08-10T23:59:59.999Z'))).toBe('2026-08-11T00:00:00.000Z');
  });

  it('rolls forward a full day from midnight itself', () => {
    expect(nextMidnightUtc(new Date('2026-08-10T00:00:00.000Z'))).toBe('2026-08-11T00:00:00.000Z');
  });

  it('crosses the year boundary', () => {
    expect(nextMidnightUtc(new Date('2026-12-31T12:00:00.000Z'))).toBe('2027-01-01T00:00:00.000Z');
  });

  it('crosses a month boundary', () => {
    expect(nextMidnightUtc(new Date('2026-08-31T18:30:00.000Z'))).toBe('2026-09-01T00:00:00.000Z');
  });

  it('lands on the leap day in a leap year', () => {
    expect(nextMidnightUtc(new Date('2028-02-28T09:00:00.000Z'))).toBe('2028-02-29T00:00:00.000Z');
  });

  it('rolls off the leap day into March', () => {
    expect(nextMidnightUtc(new Date('2028-02-29T09:00:00.000Z'))).toBe('2028-03-01T00:00:00.000Z');
  });

  it('skips Feb 29 in a non-leap year', () => {
    expect(nextMidnightUtc(new Date('2027-02-28T09:00:00.000Z'))).toBe('2027-03-01T00:00:00.000Z');
  });
});

describe('nextMonthStartUtc', () => {
  it('rolls from a 31-day month to the 1st without overflowing', () => {
    // Naive date math on Jan 31 (+1 month) lands in March. It must be Feb 1.
    expect(nextMonthStartUtc(new Date('2026-01-31T12:00:00.000Z'))).toBe('2026-02-01T00:00:00.000Z');
  });

  it('crosses the year boundary', () => {
    expect(nextMonthStartUtc(new Date('2026-12-31T23:00:00.000Z'))).toBe('2027-01-01T00:00:00.000Z');
  });

  it('rolls from the leap day into March', () => {
    expect(nextMonthStartUtc(new Date('2028-02-29T12:00:00.000Z'))).toBe('2028-03-01T00:00:00.000Z');
  });

  it('gives the same answer from any instant within a month', () => {
    const first = nextMonthStartUtc(new Date('2026-06-01T00:00:00.000Z'));
    const middle = nextMonthStartUtc(new Date('2026-06-15T13:37:00.000Z'));
    const last = nextMonthStartUtc(new Date('2026-06-30T23:59:59.999Z'));
    expect(first).toBe('2026-07-01T00:00:00.000Z');
    expect(middle).toBe(first);
    expect(last).toBe(first);
  });
});
