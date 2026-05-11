/**
 * Tier resolution.
 *
 * For C3, Pro membership is a comma-separated env whitelist
 * (`PRO_USER_IDS`). C4 swaps this for D1-backed subscription state.
 */

export type Tier = 'anonymous' | 'free' | 'pro';

export function resolveTier(
  authState: { kind: 'user'; userId: string } | { kind: 'anonymous' },
  env: { PRO_USER_IDS?: string },
): Tier {
  if (authState.kind === 'anonymous') return 'anonymous';
  const whitelist = (env.PRO_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (whitelist.includes(authState.userId)) return 'pro';
  return 'free';
}

/**
 * Returns the model to use for the *current* request given the tier and how
 * many walkthroughs the user has already used today (counted *before* this
 * one is counted in).
 *
 * Pro tiering: first 20 → Opus 4.6, next 50 → Sonnet 4.6 (degraded),
 * after that → 429.
 */
export type ModelKey =
  | { provider: 'anthropic'; id: 'claude-opus-4-6' | 'claude-sonnet-4-6' }
  | { provider: 'openrouter'; id: 'deepseek/deepseek-chat' };

export interface TierDecision {
  /** Daily ceiling for this tier. Once `used` ≥ ceiling, requests are 429. */
  ceiling: number;
  /** Model to use for *this* request. Null if the user is over the ceiling. */
  model: ModelKey | null;
  /** True when the user is on the fallback model because they exhausted
   *  their premium allotment. Always false for non-Pro tiers. */
  degraded: boolean;
  /** For Pro: how many premium (non-degraded) walkthroughs they get
   *  before degrading. Undefined for non-Pro. */
  premiumAllotment?: number;
}

const FREE_LIMIT = 5;
const ANONYMOUS_LIMIT = 1;
const PRO_OPUS_LIMIT = 20;
const PRO_TOTAL_LIMIT = 70;

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
  // Pro
  if (alreadyUsedToday < PRO_OPUS_LIMIT) {
    return {
      ceiling: PRO_TOTAL_LIMIT,
      model: OPUS,
      degraded: false,
      premiumAllotment: PRO_OPUS_LIMIT,
    };
  }
  if (alreadyUsedToday < PRO_TOTAL_LIMIT) {
    return {
      ceiling: PRO_TOTAL_LIMIT,
      model: SONNET,
      degraded: true,
      premiumAllotment: PRO_OPUS_LIMIT,
    };
  }
  return {
    ceiling: PRO_TOTAL_LIMIT,
    model: null,
    degraded: false,
    premiumAllotment: PRO_OPUS_LIMIT,
  };
}
