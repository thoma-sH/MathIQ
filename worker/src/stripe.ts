/**
 * Stripe integration. Workers-compatible (uses fetch http client).
 *
 * Responsibilities:
 *   - Build the right price id for a (tier, interval) request.
 *   - Create Checkout sessions (hosted payment page).
 *   - Create Customer Portal sessions (Stripe-hosted cancellation / card update).
 *   - Verify and parse webhook events.
 *   - Map a subscription event into our local SubscriptionState shape.
 */
import Stripe from 'stripe';
import type {
  SubscriptionInterval,
  SubscriptionState,
  SubscriptionStatus,
  SubscriptionTier,
} from './subscription';

export interface StripeEnv {
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_PLUS_MONTHLY: string;
  STRIPE_PRICE_PLUS_ANNUAL: string;
  STRIPE_PRICE_PRO_MONTHLY: string;
  STRIPE_PRICE_PRO_ANNUAL: string;
  STRIPE_PRICE_PLUS_SEMESTER: string;
  STRIPE_PRICE_PRO_SEMESTER: string;
  // Grandfathered price IDs. New checkouts use the *_MONTHLY / *_ANNUAL
  // vars above; subscribers already on the old prices keep paying their
  // bound rate, and we still need to recognize their price ID at webhook
  // time so they don't silently downgrade to free.
  STRIPE_PRICE_PRO_MONTHLY_OLD?: string;
  STRIPE_PRICE_PLUS_ANNUAL_OLD?: string;
  STRIPE_PRICE_PRO_ANNUAL_OLD?: string;
  STRIPE_SUCCESS_URL: string;
  STRIPE_CANCEL_URL: string;
  STRIPE_PORTAL_RETURN_URL: string;
}

export function makeStripe(env: StripeEnv): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });
}

export function priceIdFor(
  env: StripeEnv,
  tier: SubscriptionTier,
  interval: SubscriptionInterval,
): string {
  if (tier === 'plus') {
    if (interval === 'annual') return env.STRIPE_PRICE_PLUS_ANNUAL;
    if (interval === 'semester') return env.STRIPE_PRICE_PLUS_SEMESTER;
    return env.STRIPE_PRICE_PLUS_MONTHLY;
  }
  if (interval === 'annual') return env.STRIPE_PRICE_PRO_ANNUAL;
  if (interval === 'semester') return env.STRIPE_PRICE_PRO_SEMESTER;
  return env.STRIPE_PRICE_PRO_MONTHLY;
}

/** Reverse-lookup: figure out which (tier, interval) a Stripe price id represents.
 *  Recognizes both current and grandfathered (`_OLD`) price IDs so existing
 *  subscribers don't silently downgrade after the price reshape. */
export function priceIdToTierInterval(
  env: StripeEnv,
  priceId: string,
): { tier: SubscriptionTier; interval: SubscriptionInterval } | null {
  if (priceId === env.STRIPE_PRICE_PLUS_MONTHLY) return { tier: 'plus', interval: 'monthly' };
  if (priceId === env.STRIPE_PRICE_PLUS_ANNUAL) return { tier: 'plus', interval: 'annual' };
  if (priceId === env.STRIPE_PRICE_PRO_MONTHLY) return { tier: 'pro', interval: 'monthly' };
  if (priceId === env.STRIPE_PRICE_PRO_ANNUAL) return { tier: 'pro', interval: 'annual' };
  if (priceId === env.STRIPE_PRICE_PLUS_SEMESTER) return { tier: 'plus', interval: 'semester' };
  if (priceId === env.STRIPE_PRICE_PRO_SEMESTER) return { tier: 'pro', interval: 'semester' };
  if (env.STRIPE_PRICE_PRO_MONTHLY_OLD && priceId === env.STRIPE_PRICE_PRO_MONTHLY_OLD)
    return { tier: 'pro', interval: 'monthly' };
  if (env.STRIPE_PRICE_PLUS_ANNUAL_OLD && priceId === env.STRIPE_PRICE_PLUS_ANNUAL_OLD)
    return { tier: 'plus', interval: 'annual' };
  if (env.STRIPE_PRICE_PRO_ANNUAL_OLD && priceId === env.STRIPE_PRICE_PRO_ANNUAL_OLD)
    return { tier: 'pro', interval: 'annual' };
  return null;
}

export interface CheckoutSessionArgs {
  userId: string;
  userEmail: string | undefined;
  tier: SubscriptionTier;
  interval: SubscriptionInterval;
  existingCustomerId?: string;
}

export async function createCheckoutSession(
  stripe: Stripe,
  env: StripeEnv,
  args: CheckoutSessionArgs,
): Promise<Stripe.Checkout.Session> {
  const price = priceIdFor(env, args.tier, args.interval);

  return stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    success_url: env.STRIPE_SUCCESS_URL,
    cancel_url: env.STRIPE_CANCEL_URL,
    client_reference_id: args.userId,
    customer: args.existingCustomerId,
    customer_email: args.existingCustomerId ? undefined : args.userEmail,
    metadata: { userId: args.userId, tier: args.tier, interval: args.interval },
    subscription_data: {
      metadata: { userId: args.userId },
    },
    allow_promotion_codes: true,
  });
}

/**
 * One-time Semester checkout. Stripe `mode: 'payment'` — no recurring
 * billing. The webhook handler reads `metadata.kind = 'pass'` to know
 * this completion should create a PassState (not a SubscriptionState).
 */
export async function createOneTimeCheckoutSession(
  stripe: Stripe,
  env: StripeEnv,
  args: CheckoutSessionArgs,
): Promise<Stripe.Checkout.Session> {
  const price = priceIdFor(env, args.tier, 'semester');

  return stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price, quantity: 1 }],
    success_url: env.STRIPE_SUCCESS_URL,
    cancel_url: env.STRIPE_CANCEL_URL,
    client_reference_id: args.userId,
    customer: args.existingCustomerId,
    customer_email: args.existingCustomerId ? undefined : args.userEmail,
    metadata: {
      userId: args.userId,
      tier: args.tier,
      interval: 'semester',
      kind: 'pass',
    },
    allow_promotion_codes: true,
  });
}

export async function createPortalSession(
  stripe: Stripe,
  env: StripeEnv,
  customerId: string,
): Promise<Stripe.BillingPortal.Session> {
  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: env.STRIPE_PORTAL_RETURN_URL,
  });
}

export async function verifyWebhook(
  stripe: Stripe,
  env: StripeEnv,
  rawBody: string,
  signature: string | null,
): Promise<Stripe.Event | null> {
  if (!signature) return null;
  try {
    return await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    return null;
  }
}

/**
 * Translate a Stripe Subscription into our SubscriptionState. Returns null if
 * we can't map the price to a known tier (price not in env config).
 */
export function subscriptionToState(
  env: StripeEnv,
  subscription: Stripe.Subscription,
): SubscriptionState | null {
  const item = subscription.items.data[0];
  if (!item) return null;
  const priceId = typeof item.price === 'string' ? item.price : item.price.id;
  const mapping = priceIdToTierInterval(env, priceId);
  if (!mapping) return null;

  return {
    tier: mapping.tier,
    interval: mapping.interval,
    status: subscription.status as SubscriptionStatus,
    currentPeriodEnd: item.current_period_end,
    stripeCustomerId:
      typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer.id,
    stripeSubscriptionId: subscription.id,
  };
}
