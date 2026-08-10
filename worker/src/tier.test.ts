import { describe, it, expect } from 'vitest';
import {
  decideTier,
  dailyOpusLimit,
  monthlyOpusLimit,
  FREE_LIMIT,
  PLUS_OPUS_DAILY,
  PLUS_TOTAL_DAILY,
  PLUS_OPUS_MONTHLY,
  PRO_OPUS_DAILY,
  PRO_TOTAL_DAILY,
  PRO_OPUS_MONTHLY,
  HAIKU,
  OPUS,
  SONNET,
} from './tier';

describe('dailyOpusLimit / monthlyOpusLimit', () => {
  it('gives free and anonymous no Opus at all', () => {
    expect(dailyOpusLimit('free')).toBe(0);
    expect(dailyOpusLimit('anonymous')).toBe(0);
    expect(monthlyOpusLimit('free')).toBe(0);
    expect(monthlyOpusLimit('anonymous')).toBe(0);
  });

  it('matches the published Plus and Pro allowances', () => {
    expect(dailyOpusLimit('plus')).toBe(PLUS_OPUS_DAILY);
    expect(dailyOpusLimit('pro')).toBe(PRO_OPUS_DAILY);
    expect(monthlyOpusLimit('plus')).toBe(PLUS_OPUS_MONTHLY);
    expect(monthlyOpusLimit('pro')).toBe(PRO_OPUS_MONTHLY);
  });
});

describe('decideTier — unpaid ceilings', () => {
  it('serves anonymous one Haiku walkthrough, then nothing', () => {
    const first = decideTier('anonymous', 0);
    expect(first.model).toEqual(HAIKU);
    expect(first.ceiling).toBe(1);
    expect(first.claimsOpus).toBe(false);

    expect(decideTier('anonymous', 1).model).toBeNull();
  });

  it('serves free up to FREE_LIMIT, then nothing', () => {
    expect(decideTier('free', FREE_LIMIT - 1).model).toEqual(HAIKU);

    const spent = decideTier('free', FREE_LIMIT);
    expect(spent.model).toBeNull();
    expect(spent.ceiling).toBe(FREE_LIMIT);
  });

  it('never marks an unpaid tier as degraded — they were never eligible', () => {
    expect(decideTier('free', 0).degraded).toBe(false);
    expect(decideTier('anonymous', 0).degraded).toBe(false);
  });
});

describe('decideTier — paid daily ceiling', () => {
  it('serves Plus right up to the total, then cuts off at it', () => {
    expect(decideTier('plus', PLUS_TOTAL_DAILY - 1, 0, { opusUsedToday: 0 }).model).not.toBeNull();

    const spent = decideTier('plus', PLUS_TOTAL_DAILY);
    expect(spent.model).toBeNull();
    expect(spent.ceiling).toBe(PLUS_TOTAL_DAILY);
    expect(spent.premiumAllotment).toBe(PLUS_OPUS_DAILY);
  });

  it('serves Pro right up to the total, then cuts off at it', () => {
    expect(decideTier('pro', PRO_TOTAL_DAILY - 1, 0, { opusUsedToday: 0 }).model).not.toBeNull();

    const spent = decideTier('pro', PRO_TOTAL_DAILY);
    expect(spent.model).toBeNull();
    expect(spent.ceiling).toBe(PRO_TOTAL_DAILY);
    expect(spent.premiumAllotment).toBe(PRO_OPUS_DAILY);
  });
});

describe('decideTier — model preference', () => {
  it('gives Opus to auto and max while budget remains', () => {
    for (const preference of ['auto', 'max'] as const) {
      const decision = decideTier('plus', 0, 0, { preference, opusUsedToday: 0 });
      expect(decision.model).toEqual(OPUS);
      expect(decision.claimsOpus).toBe(true);
      expect(decision.degraded).toBe(false);
      expect(decision.downgradeReason).toBeUndefined();
    }
  });

  it('treats a user-chosen Standard as a choice, not a downgrade', () => {
    // The distinction matters: `degraded` drives the "you got downgraded"
    // banner, and spending an Opus slot on a run the user asked to be cheap
    // would defeat the entire point of the picker.
    const decision = decideTier('plus', 0, 0, { preference: 'standard', opusUsedToday: 0 });
    expect(decision.model).toEqual(SONNET);
    expect(decision.degraded).toBe(false);
    expect(decision.downgradeReason).toBe('user');
    expect(decision.claimsOpus).toBe(false);
  });
});

describe('decideTier — Opus exhaustion', () => {
  it('degrades to Sonnet once the daily Opus budget is gone', () => {
    const decision = decideTier('plus', 10, 0, {
      preference: 'max',
      opusUsedToday: PLUS_OPUS_DAILY,
    });
    expect(decision.model).toEqual(SONNET);
    expect(decision.degraded).toBe(true);
    expect(decision.downgradeReason).toBe('daily');
    expect(decision.claimsOpus).toBe(false);
  });

  it('degrades to Sonnet once the monthly Opus budget is gone', () => {
    const decision = decideTier('plus', 10, PLUS_OPUS_MONTHLY, {
      preference: 'max',
      opusUsedToday: 0,
    });
    expect(decision.model).toEqual(SONNET);
    expect(decision.degraded).toBe(true);
    expect(decision.downgradeReason).toBe('monthly');
  });

  it('names the daily wall when both walls are hit at once', () => {
    // Daily is checked first so the banner names the limit the user can
    // actually wait out — tomorrow, not next month.
    const decision = decideTier('plus', 10, PLUS_OPUS_MONTHLY, {
      preference: 'max',
      opusUsedToday: PLUS_OPUS_DAILY,
    });
    expect(decision.downgradeReason).toBe('daily');
  });

  it('applies Pro thresholds to Pro, not Plus ones', () => {
    // At 5 Opus used a Plus user is spent; a Pro user still has 3 left.
    const plus = decideTier('plus', 10, 0, { preference: 'max', opusUsedToday: PLUS_OPUS_DAILY });
    const pro = decideTier('pro', 10, 0, { preference: 'max', opusUsedToday: PLUS_OPUS_DAILY });
    expect(plus.model).toEqual(SONNET);
    expect(pro.model).toEqual(OPUS);
  });
});

describe('decideTier — the opusUsedToday fallback', () => {
  // Documented behavior (tier.ts:81-85): callers that use decideTier purely
  // as a null-gate omit opusUsedToday, and total daily usage stands in for
  // Opus usage. Pinned here because the two readings of the same number
  // produce opposite models, so any change to the default is a visible one.
  it('counts total usage as Opus usage when opusUsedToday is omitted', () => {
    const implied = decideTier('plus', PLUS_OPUS_DAILY, 0, { preference: 'max' });
    expect(implied.model).toEqual(SONNET);
    expect(implied.downgradeReason).toBe('daily');
  });

  it('serves Opus for the same usage once the real Opus count is supplied', () => {
    const measured = decideTier('plus', PLUS_OPUS_DAILY, 0, {
      preference: 'max',
      opusUsedToday: 0,
    });
    expect(measured.model).toEqual(OPUS);
    expect(measured.claimsOpus).toBe(true);
  });
});
