import { describe, it, expect } from 'vitest';
import { isEntitled, type SubscriptionState, type SubscriptionStatus } from './subscription';

const HOUR = 60 * 60;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function state(overrides: Partial<SubscriptionState> = {}): SubscriptionState {
  return {
    tier: 'plus',
    interval: 'monthly',
    status: 'active',
    currentPeriodEnd: nowSeconds() + 24 * HOUR,
    stripeCustomerId: 'cus_test',
    stripeSubscriptionId: 'sub_test',
    ...overrides,
  };
}

describe('isEntitled — statuses that grant access', () => {
  it('grants access to an active subscription inside its period', () => {
    expect(isEntitled(state())).toBe(true);
  });

  it('grants access to a trialing subscription', () => {
    // The 7-day Plus trial rides on this branch. If it ever regresses,
    // every trialing subscriber loses access instantly despite having a
    // card on file.
    expect(isEntitled(state({ status: 'trialing' }))).toBe(true);
  });

  it('grants access regardless of tier or interval', () => {
    expect(isEntitled(state({ tier: 'pro', interval: 'annual' }))).toBe(true);
    expect(isEntitled(state({ tier: 'plus', interval: 'semester' }))).toBe(true);
  });
});

describe('isEntitled — statuses that deny access', () => {
  it('denies access when there is no subscription at all', () => {
    expect(isEntitled(null)).toBe(false);
  });

  it.each<SubscriptionStatus>(['canceled', 'incomplete', 'unpaid'])(
    'denies access on %s even inside the paid period',
    (status) => {
      expect(isEntitled(state({ status }))).toBe(false);
    },
  );

  it('denies access on past_due with no grace period', () => {
    // Deliberately pinned: Stripe retries a failed renewal for days, but
    // access is revoked the moment the status flips. Changing this to allow
    // a grace window is a product decision, not a refactor — this test is
    // here so that decision can't be made by accident.
    expect(isEntitled(state({ status: 'past_due' }))).toBe(false);
  });
});

describe('isEntitled — period expiry', () => {
  it('denies access once the period has ended, even while active', () => {
    expect(isEntitled(state({ currentPeriodEnd: nowSeconds() - HOUR }))).toBe(false);
  });

  it('denies access at the exact instant the period ends', () => {
    // The comparison is strictly greater-than, so the boundary second is out.
    expect(isEntitled(state({ currentPeriodEnd: Math.floor(Date.now() / 1000) }))).toBe(false);
  });

  it('grants access one second before the period ends', () => {
    expect(isEntitled(state({ currentPeriodEnd: nowSeconds() + 2 }))).toBe(true);
  });

  it('denies an expired trial the same as an expired subscription', () => {
    expect(isEntitled(state({ status: 'trialing', currentPeriodEnd: nowSeconds() - 1 }))).toBe(
      false,
    );
  });
});
