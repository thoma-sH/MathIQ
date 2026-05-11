/**
 * Subscription state, keyed in KV by Clerk userId.
 *
 * Stripe is the system of record; we mirror the bits we need for tier
 * resolution into KV so request-path reads are O(1) and don't hit Stripe.
 * The webhook (`/api/stripe/webhook`) keeps KV in sync.
 */

export type SubscriptionTier = 'plus' | 'pro';
export type SubscriptionInterval = 'monthly' | 'annual';
export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'unpaid';

export interface SubscriptionState {
  tier: SubscriptionTier;
  interval: SubscriptionInterval;
  status: SubscriptionStatus;
  currentPeriodEnd: number;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
}

const TTL_SECONDS = 60 * 60 * 24 * 400;

function key(userId: string): string {
  return `subscription:user:${userId}`;
}

export async function getSubscription(
  kv: KVNamespace,
  userId: string,
): Promise<SubscriptionState | null> {
  const raw = await kv.get(key(userId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SubscriptionState;
  } catch {
    return null;
  }
}

export async function setSubscription(
  kv: KVNamespace,
  userId: string,
  state: SubscriptionState,
): Promise<void> {
  await kv.put(key(userId), JSON.stringify(state), {
    expirationTtl: TTL_SECONDS,
  });
}

export async function clearSubscription(
  kv: KVNamespace,
  userId: string,
): Promise<void> {
  await kv.delete(key(userId));
}

/** True if the user's subscription is currently entitling them to the paid tier. */
export function isEntitled(state: SubscriptionState | null): boolean {
  if (!state) return false;
  if (state.status !== 'active' && state.status !== 'trialing') return false;
  return state.currentPeriodEnd * 1000 > Date.now();
}

/**
 * Stripe→Clerk linkage. We store a reverse lookup so the webhook can find
 * a userId from a customer id without a Stripe metadata round-trip.
 * Key: `stripe-customer:<customerId>` → userId.
 */
function customerKey(customerId: string): string {
  return `stripe-customer:${customerId}`;
}

export async function rememberCustomer(
  kv: KVNamespace,
  customerId: string,
  userId: string,
): Promise<void> {
  await kv.put(customerKey(customerId), userId);
}

export async function findUserByCustomer(
  kv: KVNamespace,
  customerId: string,
): Promise<string | null> {
  return kv.get(customerKey(customerId));
}
