/**
 * Lifetime per-feature trials for signed-in Free users.
 *
 * Each new signup gets a small one-time allotment of every premium feature
 * so they experience the full app once before they're paywalled. Counts
 * never reset — when they hit zero, the upgrade modal fires.
 *
 * Trials are NOT for anonymous users (no userId to track) or Plus/Pro
 * users (already paid). Plus → Pro monthly trials are a separate mechanic,
 * deferred to a later phase.
 *
 * Spend is counted on the UsageCounter Durable Object, one counter per
 * (user, feature) with a fixed period so it never rolls over, because the
 * DO is the only atomic thing available here. A KV read-modify-write let
 * two concurrent requests both see one trial left and both spend it, and
 * KV reads are not read-your-writes, so that window was seconds wide, not
 * microseconds. The old KV record (`trials:user:USERID`) is still read as
 * the baseline of what a user had before the counter existed, and is never
 * written again.
 */
import { decrement, increment, peek, type CounterRef } from './rateLimit';

export interface TrialsEnv {
  USAGE: KVNamespace;
  USAGE_DO: DurableObjectNamespace;
}

const TRIALS_KEY_PREFIX = 'trials:user:';

export type TrialFeature =
  | 'photoInput'
  | 'whyHow'
  | 'handwrittenPdf'
  | 'latex'
  | 'examGen'
  | 'examGrade';

export type TrialState = Record<TrialFeature, number>;

/** Initial lifetime allotment. Tuned: large enough to taste each feature,
 *  small enough that a homework workflow can't be done entirely on trials. */
export const INITIAL_TRIALS: TrialState = {
  photoInput: 3,
  whyHow: 5,
  handwrittenPdf: 2,
  latex: 1,
  examGen: 1,
  examGrade: 2,
};

function key(userId: string): string {
  return `${TRIALS_KEY_PREFIX}${userId}`;
}

const FEATURES: TrialFeature[] = [
  'photoInput',
  'whyHow',
  'handwrittenPdf',
  'latex',
  'examGen',
  'examGrade',
];

function counter(ns: DurableObjectNamespace, userId: string, feature: TrialFeature): CounterRef {
  return { ns, name: `user:${userId}:trial:${feature}`, period: 'lifetime' };
}

/**
 * What the user still had before the counter existed: the KV record if
 * there is one, the initial allotment otherwise. Read only — the counter
 * carries every spend from here on.
 */
async function legacyRemaining(kv: KVNamespace, userId: string): Promise<TrialState> {
  const raw = await kv.get(key(userId));
  if (!raw) return { ...INITIAL_TRIALS };
  try {
    const parsed = JSON.parse(raw) as Partial<TrialState>;
    return {
      photoInput: numeric(parsed.photoInput, INITIAL_TRIALS.photoInput),
      whyHow: numeric(parsed.whyHow, INITIAL_TRIALS.whyHow),
      handwrittenPdf: numeric(parsed.handwrittenPdf, INITIAL_TRIALS.handwrittenPdf),
      latex: numeric(parsed.latex, INITIAL_TRIALS.latex),
      examGen: numeric(parsed.examGen, INITIAL_TRIALS.examGen),
      examGrade: numeric(parsed.examGrade, INITIAL_TRIALS.examGrade),
    };
  } catch {
    return { ...INITIAL_TRIALS };
  }
}

/** Current remaining trials: the legacy baseline less what the counter has
 *  recorded since. Six peeks, one per feature. */
export async function getRemainingTrials(env: TrialsEnv, userId: string): Promise<TrialState> {
  const legacy = await legacyRemaining(env.USAGE, userId);
  const spent = await Promise.all(
    FEATURES.map((feature) => peek(counter(env.USAGE_DO, userId, feature))),
  );
  const remaining = { ...legacy };
  FEATURES.forEach((feature, i) => {
    remaining[feature] = Math.max(0, legacy[feature] - spent[i]);
  });
  return remaining;
}

/**
 * Check and consume one trial in a single atomic step: the counter is
 * incremented first, and if that takes the user below zero the increment
 * is handed straight back. Returns the new remaining count, or null if
 * the user is out.
 */
export async function consumeTrial(
  env: TrialsEnv,
  userId: string,
  feature: TrialFeature,
): Promise<number | null> {
  const ref = counter(env.USAGE_DO, userId, feature);
  const legacy = (await legacyRemaining(env.USAGE, userId))[feature];
  const spent = await increment(ref);
  const remaining = legacy - spent;
  if (remaining < 0) {
    await decrement(ref);
    return null;
  }
  return remaining;
}

/**
 * Refund a previously-consumed trial. Use on upstream failure so the user
 * isn't penalized for an error they didn't cause. The counter clamps at
 * zero, so a refund can never grant more than the user started with.
 */
export async function refundTrial(
  env: TrialsEnv,
  userId: string,
  feature: TrialFeature,
): Promise<void> {
  await decrement(counter(env.USAGE_DO, userId, feature));
}

function numeric(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
}
