/**
 * Per-user streak tracking for the Daily Challenge.
 *
 * KV: `streak:user:USERID` → StreakState
 *
 * Rules (Wordle pattern + Duolingo freeze):
 *   - Correct submission today extends the streak (or restarts at 1)
 *   - Incorrect submission breaks the streak (current resets to 0)
 *   - Missing exactly one day auto-consumes a freeze (if available) and
 *     extends the streak; missing two or more days always breaks it
 *   - Freezes refill to 1 at the start of each UTC calendar month
 *   - Same-day re-submission is idempotent — the first submission wins
 */

const STREAK_KEY_PREFIX = 'streak:user:';
// TTL — long enough that even an inactive user keeps their record around to
// see "your longest streak was N" on return.
const STREAK_TTL_SECONDS = 365 * 24 * 60 * 60;

const FREEZES_PER_MONTH = 1;

export interface StreakState {
  current: number;
  longest: number;
  /** YYYY-MM-DD of the last day a submission was recorded. Null on first ever access. */
  lastSolvedDate: string | null;
  /** Freezes available this month. Refills to 1 on the 1st of each UTC month. */
  freezes: number;
  /** YYYY-MM that `freezes` was last refilled to FREEZES_PER_MONTH. */
  freezeMonth: string | null;
  /** True iff a freeze was just consumed by recordSolve (lets the UI cheer:
   *  "Saved by a freeze!"). Sticky for the response only — not persisted. */
  freezeConsumed?: boolean;
}

function key(userId: string): string {
  return `${STREAK_KEY_PREFIX}${userId}`;
}

const EMPTY_STATE: StreakState = {
  current: 0,
  longest: 0,
  lastSolvedDate: null,
  freezes: FREEZES_PER_MONTH,
  freezeMonth: null,
};

function refillFreezesIfNeeded(state: StreakState, today: string): StreakState {
  const todayMonth = today.slice(0, 7); // YYYY-MM
  if (state.freezeMonth === todayMonth) return state;
  return {
    ...state,
    freezes: FREEZES_PER_MONTH,
    freezeMonth: todayMonth,
  };
}

export async function getStreak(
  kv: KVNamespace,
  userId: string,
  today?: string,
): Promise<StreakState> {
  const raw = await kv.get(key(userId));
  let state: StreakState;
  if (!raw) {
    state = { ...EMPTY_STATE };
  } else {
    try {
      const parsed = JSON.parse(raw) as Partial<StreakState>;
      state = {
        current: typeof parsed.current === 'number' ? parsed.current : 0,
        longest: typeof parsed.longest === 'number' ? parsed.longest : 0,
        lastSolvedDate:
          typeof parsed.lastSolvedDate === 'string' ? parsed.lastSolvedDate : null,
        freezes:
          typeof parsed.freezes === 'number' ? parsed.freezes : FREEZES_PER_MONTH,
        freezeMonth:
          typeof parsed.freezeMonth === 'string' ? parsed.freezeMonth : null,
      };
    } catch {
      state = { ...EMPTY_STATE };
    }
  }
  // Apply the monthly freeze refill on every read so the UI shows the
  // accurate count even before the user submits.
  if (today) state = refillFreezesIfNeeded(state, today);
  return state;
}

/**
 * Record a submission and return the resulting streak state.
 *
 * `today` is passed in (rather than read from `new Date()`) so the caller
 * can pass the same UTC date used by the daily challenge key — avoids
 * subtle midnight-edge bugs.
 */
export async function recordSolve(
  kv: KVNamespace,
  userId: string,
  correct: boolean,
  today: string,
): Promise<StreakState> {
  const prior = refillFreezesIfNeeded(await getStreak(kv, userId), today);

  // Idempotent: already recorded today, don't double-count.
  if (prior.lastSolvedDate === today) return prior;

  let nextCurrent: number;
  let nextFreezes = prior.freezes;
  let freezeConsumed = false;

  if (!correct) {
    nextCurrent = 0;
  } else if (prior.lastSolvedDate && isYesterday(prior.lastSolvedDate, today)) {
    nextCurrent = prior.current + 1;
  } else if (
    prior.lastSolvedDate &&
    isTwoDaysAgo(prior.lastSolvedDate, today) &&
    prior.freezes > 0 &&
    prior.current > 0
  ) {
    // Missed exactly one day, freeze available — consume it and keep the
    // streak alive at its current length + 1 (today's solve).
    nextCurrent = prior.current + 1;
    nextFreezes = prior.freezes - 1;
    freezeConsumed = true;
  } else {
    // First-ever solve, gap > 2 days, or out of freezes — fresh streak.
    nextCurrent = 1;
  }

  const next: StreakState = {
    current: nextCurrent,
    longest: Math.max(nextCurrent, prior.longest),
    lastSolvedDate: today,
    freezes: nextFreezes,
    freezeMonth: prior.freezeMonth ?? today.slice(0, 7),
  };

  await kv.put(key(userId), JSON.stringify(next), {
    expirationTtl: STREAK_TTL_SECONDS,
  });
  // freezeConsumed is a per-response signal, not persisted state. Adding
  // it after the put so it doesn't end up in KV.
  return freezeConsumed ? { ...next, freezeConsumed: true } : next;
}

function isYesterday(priorDate: string, today: string): boolean {
  return daysBetween(priorDate, today) === 1;
}

function isTwoDaysAgo(priorDate: string, today: string): boolean {
  return daysBetween(priorDate, today) === 2;
}

function daysBetween(priorDate: string, today: string): number {
  const [py, pm, pd] = priorDate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const priorMs = Date.UTC(py, pm - 1, pd);
  const todayMs = Date.UTC(ty, tm - 1, td);
  return Math.round((todayMs - priorMs) / (24 * 60 * 60 * 1000));
}
