/**
 * Tier resolution.
 *
 * Identifiers:
 *   'anonymous' — not signed in
 *   'free'      — signed in, no paid plan
 *   'plus'      — MathIQ+   ($7.99/mo or $3.99/mo annual): 15 Opus + 40 Sonnet daily
 *   'pro'       — MathIQ Pro ($19.99/mo or $8.99/mo annual): 40 Opus daily
 *
 * Resolution order:
 *   1. Anonymous if not signed in.
 *   2. Env whitelist (PRO_USER_IDS / MAX_USER_IDS) — manual dev override.
 *   3. Stripe-granted subscription state from KV (paying customers).
 *   4. Free otherwise.
 */
import {
  getActivePass,
  getSubscription,
  isEntitled,
  type SubscriptionState,
} from './subscription';

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
      .split(/[,\s]+/)
      .filter(Boolean)
      .includes(authState.userId);
  if (inList(env.MAX_USER_IDS)) return 'pro';
  if (inList(env.PRO_USER_IDS)) return 'plus';

  const sub: SubscriptionState | null = await getSubscription(env.USAGE, authState.userId);
  if (isEntitled(sub) && sub) return sub.tier;

  // Semester one-time pass. Subscription wins if both exist (handled by the
  // early return above) — we only fall through here if no active sub.
  const pass = await getActivePass(env.USAGE, authState.userId);
  if (pass) return pass.tier;

  return 'free';
}

export type ModelKey =
  | { provider: 'anthropic'; id: 'claude-opus-4-6' | 'claude-sonnet-4-6' | 'claude-haiku-4-5' }
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
const PLUS_OPUS_LIMIT = 15;
const PLUS_TOTAL_LIMIT = 55;
const PRO_LIMIT = 40;

const HAIKU: ModelKey = { provider: 'anthropic', id: 'claude-haiku-4-5' };
const OPUS: ModelKey = { provider: 'anthropic', id: 'claude-opus-4-6' };
const SONNET: ModelKey = { provider: 'anthropic', id: 'claude-sonnet-4-6' };

export function decideTier(tier: Tier, alreadyUsedToday: number): TierDecision {
  if (tier === 'anonymous') {
    return {
      ceiling: ANONYMOUS_LIMIT,
      model: alreadyUsedToday < ANONYMOUS_LIMIT ? HAIKU : null,
      degraded: false,
    };
  }
  if (tier === 'free') {
    return {
      ceiling: FREE_LIMIT,
      model: alreadyUsedToday < FREE_LIMIT ? HAIKU : null,
      degraded: false,
    };
  }
  if (tier === 'pro') {
    // MathIQ Pro: 40 Opus calls daily, no degradation.
    return {
      ceiling: PRO_LIMIT,
      model: alreadyUsedToday < PRO_LIMIT ? OPUS : null,
      degraded: false,
      premiumAllotment: PRO_LIMIT,
    };
  }
  // MathIQ+ ('plus'): 15 Opus then 40 Sonnet, total 55.
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
