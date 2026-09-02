/**
 * Tier resolution.
 *
 * Identifiers:
 *   'anonymous' — not signed in
 *   'free'      — signed in, no paid plan
 *   'plus'      — MathIQ+   ($7.99/mo or $5.99/mo annual): 5 Opus + 20 Sonnet daily (25 total), 100 Opus/month
 *   'pro'       — MathIQ Pro ($12.99/mo or $9.99/mo annual): 8 Opus + 30 Sonnet daily (38 total), 150 Opus/month
 *
 * The monthly Opus ceiling sits on top of the daily caps: once a paid user
 * exhausts their monthly Opus allowance, decideTier auto-degrades their
 * remaining daily Opus slots to Sonnet. Daily total still flows; only the
 * model quality drops.
 *
 * Paid users choose per request (see ModelPreference). Opus is spent only on
 * an explicit 'max', tracked by its own daily counter, so picking 'standard'
 * banks the slot instead of burning it.
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

/**
 * What the user asked for on this request.
 *   'standard' — Sonnet by choice. Doesn't touch the Opus budget.
 *   'max'      — Opus, if any budget is left.
 *   'auto'     — Opus while eligible. What a missing field resolves to, so
 *                clients deployed before the picker existed keep their old
 *                behavior.
 */
export type ModelPreference = 'auto' | 'max' | 'standard';

export interface DecideTierOptions {
  /** Ignored for free/anonymous — those tiers are Haiku-only by construction. */
  preference?: ModelPreference;
  /** Opus walkthroughs already served today, from the dedicated daily-Opus
   *  counter. When omitted we fall back to the daily TOTAL count, which is the
   *  pre-picker behavior — that default is what lets the callers who use
   *  decideTier purely as a null-gate stay untouched. */
  opusUsedToday?: number;
}

export interface TierDecision {
  /** Daily ceiling for this tier. Once `used` ≥ ceiling, requests are 429. */
  ceiling: number;
  /** Model to use for *this* request. Null if the user is over the ceiling. */
  model: ModelKey | null;
  /** True when the user *wanted* Opus and couldn't have it. Drives the
   *  "you got downgraded" banner, so a user-chosen Sonnet must NOT set it.
   *  Always false for non-paid tiers. */
  degraded: boolean;
  /** For paid tiers with a premium allotment: how many premium (non-degraded)
   *  walkthroughs the user gets before degrading. Undefined for non-paid. */
  premiumAllotment?: number;
  /** True when serving this request has to consume a daily + monthly Opus
   *  slot, so the handler never has to string-compare model ids. */
  claimsOpus?: boolean;
  /** Why we're not on Opus. 'user' = they picked standard, so no banner.
   *  'daily'/'monthly' = quota exhaustion, banner. Absent on Opus and Haiku. */
  downgradeReason?: 'user' | 'daily' | 'monthly';
}

export const ANONYMOUS_LIMIT = 5;
export const FREE_LIMIT = 3;

export const PLUS_OPUS_DAILY = 5;
export const PLUS_TOTAL_DAILY = 25;
export const PLUS_OPUS_MONTHLY = 100;

export const PRO_OPUS_DAILY = 8;
export const PRO_TOTAL_DAILY = 38;
export const PRO_OPUS_MONTHLY = 150;

/**
 * Practice-problem invention ceilings. Not a product limit — a statement is a
 * few hundred Haiku tokens on top of a cached prefix, so "Try one like this"
 * is free at every tier and never touches the walkthrough quota. These numbers
 * only exist so nobody can sit on the button.
 */
export const INVENT_DAILY_ANON = 5;
export const INVENT_DAILY_FREE = 25;
export const INVENT_DAILY_PAID = 100;

export function inventDailyLimit(tier: Tier): number {
  if (tier === 'plus' || tier === 'pro') return INVENT_DAILY_PAID;
  if (tier === 'free') return INVENT_DAILY_FREE;
  return INVENT_DAILY_ANON;
}

/**
 * Ceilings for the two helper calls that ride alongside a walkthrough: the
 * topic classifier and the answer verifier. Both stay open to anonymous
 * callers on purpose — gating them would make the product feel broken before
 * a student has typed a second problem — but open and uncounted is a way for
 * a script to spend the Anthropic key, so each gets its own daily counter.
 * Loose next to the walkthrough caps, because a search can take a few tries
 * before it lands on a topic, and keyed on signed-in vs not rather than paid
 * tier so the classifier never has to resolve a subscription first.
 */
export const AUX_DAILY_ANON = 15;
export const AUX_DAILY_USER = 60;

/**
 * Daily photo-OCR ceiling. Free users are bounded by their lifetime
 * photoInput trial as well; anonymous callers never reach OCR. A subscription
 * used to be the only gate, which meant one Plus account could run Sonnet
 * vision without limit.
 */
export const OCR_DAILY = 40;

// `satisfies` rather than a `: ModelKey` annotation so `HAIKU.id` stays the
// single Haiku literal. Callers that pin the model (see handleInvent) need the
// narrow type; widening it to the whole union would make them reach for a cast.
export const HAIKU = {
  provider: 'anthropic',
  id: 'claude-haiku-4-5',
} as const satisfies ModelKey;
export const OPUS: ModelKey = { provider: 'anthropic', id: 'claude-opus-4-6' };
export const SONNET = {
  provider: 'anthropic',
  id: 'claude-sonnet-4-6',
} as const satisfies ModelKey;

/** Monthly Opus ceiling for a given tier. Free/anonymous don't get Opus at all. */
export function monthlyOpusLimit(tier: Tier): number {
  if (tier === 'pro') return PRO_OPUS_MONTHLY;
  if (tier === 'plus') return PLUS_OPUS_MONTHLY;
  return 0;
}

/** Daily Opus ceiling for a given tier. Free/anonymous don't get Opus at all. */
export function dailyOpusLimit(tier: Tier): number {
  if (tier === 'pro') return PRO_OPUS_DAILY;
  if (tier === 'plus') return PLUS_OPUS_DAILY;
  return 0;
}

export function decideTier(
  tier: Tier,
  alreadyUsedToday: number,
  alreadyUsedThisMonthOpus: number = 0,
  opts: DecideTierOptions = {},
): TierDecision {
  if (tier === 'anonymous') {
    return {
      ceiling: ANONYMOUS_LIMIT,
      model: alreadyUsedToday < ANONYMOUS_LIMIT ? HAIKU : null,
      degraded: false,
      claimsOpus: false,
    };
  }
  if (tier === 'free') {
    return {
      ceiling: FREE_LIMIT,
      model: alreadyUsedToday < FREE_LIMIT ? HAIKU : null,
      degraded: false,
      claimsOpus: false,
    };
  }

  // Paid tiers — Plus and Pro share the same Opus-then-Sonnet pattern; only
  // the daily/monthly numbers differ.
  const isPro = tier === 'pro';
  const dailyOpus = isPro ? PRO_OPUS_DAILY : PLUS_OPUS_DAILY;
  const dailyTotal = isPro ? PRO_TOTAL_DAILY : PLUS_TOTAL_DAILY;
  const monthlyOpus = isPro ? PRO_OPUS_MONTHLY : PLUS_OPUS_MONTHLY;

  // Hard daily ceiling — no model at all. This is the only branch the callers
  // that use decideTier as a plain null-gate can observe.
  if (alreadyUsedToday >= dailyTotal) {
    return {
      ceiling: dailyTotal,
      model: null,
      degraded: false,
      premiumAllotment: dailyOpus,
      claimsOpus: false,
    };
  }

  const preference: ModelPreference = opts.preference ?? 'auto';
  const opusUsedToday = opts.opusUsedToday ?? alreadyUsedToday;

  // The user deliberately picked the cheaper model to bank their Opus. Not a
  // downgrade: no banner, and no Opus slot consumed.
  if (preference === 'standard') {
    return {
      ceiling: dailyTotal,
      model: SONNET,
      degraded: false,
      premiumAllotment: dailyOpus,
      claimsOpus: false,
      downgradeReason: 'user',
    };
  }

  // 'auto' and 'max' both want Opus. Daily is checked before monthly so the
  // reason names the wall the user actually hit.
  if (opusUsedToday >= dailyOpus) {
    return {
      ceiling: dailyTotal,
      model: SONNET,
      degraded: true,
      premiumAllotment: dailyOpus,
      claimsOpus: false,
      downgradeReason: 'daily',
    };
  }
  if (alreadyUsedThisMonthOpus >= monthlyOpus) {
    return {
      ceiling: dailyTotal,
      model: SONNET,
      degraded: true,
      premiumAllotment: dailyOpus,
      claimsOpus: false,
      downgradeReason: 'monthly',
    };
  }

  return {
    ceiling: dailyTotal,
    model: OPUS,
    degraded: false,
    premiumAllotment: dailyOpus,
    claimsOpus: true,
  };
}
