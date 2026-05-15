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
 * KV: `trials:user:USERID` → TrialState
 */

const TRIALS_KEY_PREFIX = 'trials:user:';
// Long TTL so a user's trial state survives even a year of inactivity.
// At reactivation they pick up where they left off.
const TRIALS_TTL_SECONDS = 2 * 365 * 24 * 60 * 60;

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

/**
 * Get a user's current trial state. Initializes from INITIAL_TRIALS on
 * first access (without writing — only writes happen on consume/refund so
 * read-only flows don't burn KV writes).
 */
export async function getRemainingTrials(
  kv: KVNamespace,
  userId: string,
): Promise<TrialState> {
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

/**
 * Atomically check + consume one trial for the given feature. Returns
 * the new remaining count if successful, or null if the user is out.
 *
 * KV doesn't expose CAS, so a race between two concurrent reads can in
 * theory let a user spend one extra trial. Tolerable: feature trials are
 * 1–5, and the cost of an extra trial is bounded ($0.10 worst case).
 */
export async function consumeTrial(
  kv: KVNamespace,
  userId: string,
  feature: TrialFeature,
): Promise<number | null> {
  const state = await getRemainingTrials(kv, userId);
  if (state[feature] <= 0) return null;
  state[feature] = state[feature] - 1;
  await kv.put(key(userId), JSON.stringify(state), {
    expirationTtl: TRIALS_TTL_SECONDS,
  });
  return state[feature];
}

/**
 * Refund a previously-consumed trial. Use on upstream failure so the
 * user isn't penalized for an error they didn't cause.
 */
export async function refundTrial(
  kv: KVNamespace,
  userId: string,
  feature: TrialFeature,
): Promise<void> {
  const state = await getRemainingTrials(kv, userId);
  // Cap at the initial allotment — we never want a refund to grant *more*
  // trials than the user originally had (would happen if state was reset
  // somehow between consume and refund).
  state[feature] = Math.min(state[feature] + 1, INITIAL_TRIALS[feature]);
  await kv.put(key(userId), JSON.stringify(state), {
    expirationTtl: TRIALS_TTL_SECONDS,
  });
}

function numeric(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
}
