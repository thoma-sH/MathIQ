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
    return interval === 'annual' ? env.STRIPE_PRICE_PLUS_ANNUAL : env.STRIPE_PRICE_PLUS_MONTHLY;
  }
  return interval === 'annual' ? env.STRIPE_PRICE_PRO_ANNUAL : env.STRIPE_PRICE_PRO_MONTHLY;
}

/** Reverse-lookup: figure out which (tier, interval) a Stripe price id represents. */
export function priceIdToTierInterval(
  env: StripeEnv,
  priceId: string,
): { tier: SubscriptionTier; interval: SubscriptionInterval } | null {
  if (priceId === env.STRIPE_PRICE_PLUS_MONTHLY) return { tier: 'plus', interval: 'monthly' };
  if (priceId === env.STRIPE_PRICE_PLUS_ANNUAL) return { tier: 'plus', interval: 'annual' };
  if (priceId === env.STRIPE_PRICE_PRO_MONTHLY) return { tier: 'pro', interval: 'monthly' };
  if (priceId === env.STRIPE_PRICE_PRO_ANNUAL) return { tier: 'pro', interval: 'annual' };
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
