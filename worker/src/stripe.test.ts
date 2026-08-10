import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import {
  priceIdFor,
  priceIdToTierInterval,
  subscriptionToState,
  type StripeEnv,
} from './stripe';
import type { SubscriptionInterval, SubscriptionTier } from './subscription';

const env: StripeEnv = {
  STRIPE_SECRET_KEY: 'sk_test',
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  STRIPE_PRICE_PLUS_MONTHLY: 'price_plus_monthly',
  STRIPE_PRICE_PLUS_ANNUAL: 'price_plus_annual',
  STRIPE_PRICE_PLUS_SEMESTER: 'price_plus_semester',
  STRIPE_PRICE_PRO_MONTHLY: 'price_pro_monthly',
  STRIPE_PRICE_PRO_ANNUAL: 'price_pro_annual',
  STRIPE_PRICE_PRO_SEMESTER: 'price_pro_semester',
  STRIPE_PRICE_PLUS_MONTHLY_OLD: 'price_plus_monthly_old',
  STRIPE_PRICE_PLUS_ANNUAL_OLD: 'price_plus_annual_old',
  STRIPE_PRICE_PLUS_SEMESTER_OLD: 'price_plus_semester_old',
  STRIPE_PRICE_PRO_MONTHLY_OLD: 'price_pro_monthly_old',
  STRIPE_PRICE_PRO_ANNUAL_OLD: 'price_pro_annual_old',
  STRIPE_PRICE_PRO_SEMESTER_OLD: 'price_pro_semester_old',
  STRIPE_SUCCESS_URL: 'https://example.test/success',
  STRIPE_CANCEL_URL: 'https://example.test/cancel',
  STRIPE_PORTAL_RETURN_URL: 'https://example.test/',
};

const COMBINATIONS: Array<[SubscriptionTier, SubscriptionInterval, string]> = [
  ['plus', 'monthly', 'price_plus_monthly'],
  ['plus', 'annual', 'price_plus_annual'],
  ['plus', 'semester', 'price_plus_semester'],
  ['pro', 'monthly', 'price_pro_monthly'],
  ['pro', 'annual', 'price_pro_annual'],
  ['pro', 'semester', 'price_pro_semester'],
];

describe('priceIdFor', () => {
  it.each(COMBINATIONS)('resolves %s / %s', (tier, interval, expected) => {
    expect(priceIdFor(env, tier, interval)).toBe(expected);
  });
});

describe('priceIdToTierInterval', () => {
  it.each(COMBINATIONS)('maps the live %s / %s price back', (tier, interval, priceId) => {
    expect(priceIdToTierInterval(env, priceId)).toEqual({ tier, interval });
  });

  it('round-trips every live combination through both directions', () => {
    for (const [tier, interval] of COMBINATIONS) {
      expect(priceIdToTierInterval(env, priceIdFor(env, tier, interval))).toEqual({
        tier,
        interval,
      });
    }
  });

  // The highest-consequence case in this file. A renewal webhook arrives
  // carrying whatever price the subscriber originally bought. If a retired
  // price fails to map, subscriptionToState returns null, the webhook writes
  // nothing, and a paying customer silently drops to free at renewal.
  it.each<[SubscriptionTier, SubscriptionInterval, string]>([
    ['plus', 'monthly', 'price_plus_monthly_old'],
    ['plus', 'annual', 'price_plus_annual_old'],
    ['plus', 'semester', 'price_plus_semester_old'],
    ['pro', 'monthly', 'price_pro_monthly_old'],
    ['pro', 'annual', 'price_pro_annual_old'],
    ['pro', 'semester', 'price_pro_semester_old'],
  ])('still recognizes the grandfathered %s / %s price', (tier, interval, priceId) => {
    expect(priceIdToTierInterval(env, priceId)).toEqual({ tier, interval });
  });

  it('returns null for a price it has never seen', () => {
    expect(priceIdToTierInterval(env, 'price_not_ours')).toBeNull();
  });

  it('does not match an unset grandfathered slot against an empty price id', () => {
    // The _OLD lookups are guarded on the var being truthy. Without that
    // guard an empty price id would match every unconfigured slot and hand
    // out a tier for free.
    const withoutOld: StripeEnv = { ...env };
    delete withoutOld.STRIPE_PRICE_PLUS_MONTHLY_OLD;
    delete withoutOld.STRIPE_PRICE_PLUS_ANNUAL_OLD;
    delete withoutOld.STRIPE_PRICE_PLUS_SEMESTER_OLD;
    delete withoutOld.STRIPE_PRICE_PRO_MONTHLY_OLD;
    delete withoutOld.STRIPE_PRICE_PRO_ANNUAL_OLD;
    delete withoutOld.STRIPE_PRICE_PRO_SEMESTER_OLD;

    expect(priceIdToTierInterval(withoutOld, '')).toBeNull();
    expect(priceIdToTierInterval(withoutOld, 'price_plus_monthly_old')).toBeNull();
  });
});

/** Minimal Stripe.Subscription stand-in — only the fields the mapper reads. */
function subscription(opts: {
  priceId: string;
  status?: string;
  currentPeriodEnd?: number;
  customer?: string | { id: string };
  id?: string;
  noItems?: boolean;
}): Stripe.Subscription {
  return {
    id: opts.id ?? 'sub_test',
    status: opts.status ?? 'active',
    customer: opts.customer ?? 'cus_test',
    items: {
      data: opts.noItems
        ? []
        : [{ price: { id: opts.priceId }, current_period_end: opts.currentPeriodEnd ?? 1_800_000_000 }],
    },
  } as unknown as Stripe.Subscription;
}

describe('subscriptionToState', () => {
  it('maps a live subscription onto stored state', () => {
    const state = subscriptionToState(
      env,
      subscription({ priceId: 'price_pro_annual', currentPeriodEnd: 1_800_000_000 }),
    );
    expect(state).toEqual({
      tier: 'pro',
      interval: 'annual',
      status: 'active',
      currentPeriodEnd: 1_800_000_000,
      stripeCustomerId: 'cus_test',
      stripeSubscriptionId: 'sub_test',
    });
  });

  it('carries the Stripe status through verbatim', () => {
    const state = subscriptionToState(
      env,
      subscription({ priceId: 'price_plus_monthly', status: 'trialing' }),
    );
    expect(state?.status).toBe('trialing');
  });

  it('maps a grandfathered price to its tier', () => {
    const state = subscriptionToState(env, subscription({ priceId: 'price_plus_annual_old' }));
    expect(state?.tier).toBe('plus');
    expect(state?.interval).toBe('annual');
  });

  it('unwraps an expanded customer object', () => {
    const state = subscriptionToState(
      env,
      subscription({ priceId: 'price_plus_monthly', customer: { id: 'cus_expanded' } }),
    );
    expect(state?.stripeCustomerId).toBe('cus_expanded');
  });

  it('returns null for an unrecognized price rather than guessing a tier', () => {
    expect(subscriptionToState(env, subscription({ priceId: 'price_not_ours' }))).toBeNull();
  });

  it('returns null when the subscription carries no line items', () => {
    expect(subscriptionToState(env, subscription({ priceId: 'price_plus_monthly', noItems: true })))
      .toBeNull();
  });
});
