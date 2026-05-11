/**
 * Tier resolution.
 *
 * Identifiers:
 *   'anonymous' — not signed in
 *   'free'      — signed in, no paid plan
 *   'plus'      — MathIQ+   ($7.99/mo or $4.99/mo annual): 20 Opus + 50 Sonnet daily
 *   'pro'       — MathIQ Pro ($29.99/mo or $19.99/mo annual): 70 Opus daily
 *
 * Resolution order:
 *   1. Anonymous if not signed in.
 *   2. Env whitelist (PRO_USER_IDS / MAX_USER_IDS) — manual dev override.
 *   3. Stripe-granted subscription state from KV (paying customers).
 *   4. Free otherwise.
 */
import { getSubscription, isEntitled, type SubscriptionState } from './subscription';

export type Tier = 'anonymous' | 'free' | 'plus' | 'pro';

interface ResolveTierEnv {
  PRO_USER_IDS?: string;
  MAX_USER_IDS?: string;
  USAGE: KVNamespace;
}

export async function resolveTier(
  authState: { kind: 'user'; userId: string } | { kind: 'anonymous' },
  env: ResolveTierEnv,
): Promise<Tier> {
  if (authState.kind === 'anonymous') return 'anonymous';
  const inList = (raw: string | undefined) =>
    (raw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .includes(authState.userId);
  if (inList(env.MAX_USER_IDS)) return 'pro';
  if (inList(env.PRO_USER_IDS)) return 'plus';

  const sub: SubscriptionState | null = await getSubscription(env.USAGE, authState.userId);
  if (isEntitled(sub) && sub) return sub.tier;

  return 'free';
}

export type ModelKey =
  | { provider: 'anthropic'; id: 'claude-opus-4-6' | 'claude-sonnet-4-6' }
  | { provider: 'openrouter'; id: 'deepseek/deepseek-chat' };

export interface TierDecision {
  /** Daily ceiling for this tier. Once `used` ≥ ceiling, requests are 429. */
  ceiling: number;
  /** Model to use for *this* request. Null if the user is over the ceiling. */
  model: ModelKey | null;
  /** True when the user is on the fallback model because they exhausted
   *  their premium allotment. Always false for non-paid tiers. */
  degraded: boolean;
  /** For paid tiers with a premium allotment: how many premium (non-degraded)
   *  walkthroughs the user gets before degrading. Undefined for free tiers. */
  premiumAllotment?: number;
}

const ANONYMOUS_LIMIT = 1;
const FREE_LIMIT = 5;
const PLUS_OPUS_LIMIT = 20;
const PLUS_TOTAL_LIMIT = 70;
const PRO_LIMIT = 70;

const DEEPSEEK: ModelKey = { provider: 'openrouter', id: 'deepseek/deepseek-chat' };
const OPUS: ModelKey = { provider: 'anthropic', id: 'claude-opus-4-6' };
const SONNET: ModelKey = { provider: 'anthropic', id: 'claude-sonnet-4-6' };

export function decideTier(tier: Tier, alreadyUsedToday: number): TierDecision {
  if (tier === 'anonymous') {
    return {
      ceiling: ANONYMOUS_LIMIT,
      model: alreadyUsedToday < ANONYMOUS_LIMIT ? DEEPSEEK : null,
      degraded: false,
    };
  }
  if (tier === 'free') {
    return {
      ceiling: FREE_LIMIT,
      model: alreadyUsedToday < FREE_LIMIT ? DEEPSEEK : null,
      degraded: false,
    };
  }
  if (tier === 'pro') {
    // MathIQ Pro: 70 Opus calls daily, no degradation.
    return {
      ceiling: PRO_LIMIT,
      model: alreadyUsedToday < PRO_LIMIT ? OPUS : null,
      degraded: false,
      premiumAllotment: PRO_LIMIT,
    };
  }
  // MathIQ+ ('plus'): 20 Opus then 50 Sonnet, total 70.
  if (alreadyUsedToday < PLUS_OPUS_LIMIT) {
    return {
      ceiling: PLUS_TOTAL_LIMIT,
      model: OPUS,
      degraded: false,
      premiumAllotment: PLUS_OPUS_LIMIT,
    };
  }
  if (alreadyUsedToday < PLUS_TOTAL_LIMIT) {
    return {
      ceiling: PLUS_TOTAL_LIMIT,
      model: SONNET,
      degraded: true,
      premiumAllotment: PLUS_OPUS_LIMIT,
    };
  }
  return {
    ceiling: PLUS_TOTAL_LIMIT,
    model: null,
    degraded: false,
    premiumAllotment: PLUS_OPUS_LIMIT,
  };
}
