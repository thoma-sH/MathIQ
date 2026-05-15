/**
 * Per-user streak tracking for the Daily Challenge.
 *
 * KV: `streak:user:USERID` → StreakState
 *
 * Rules (Wordle pattern):
 *   - Correct submission today extends the streak (or restarts at 1)
 *   - Incorrect submission breaks the streak (current resets to 0)
 *   - Missing a day breaks the streak (detected on next submission: the gap
 *     between lastSolvedDate and today's date will be > 1 day)
 *   - Same-day re-submission is idempotent — the first submission wins
 *
 * Streak freezes (Duolingo's retention trick) are deferred to Phase 3 to
 * keep MVP simple.
 */

const STREAK_KEY_PREFIX = 'streak:user:';
// TTL — long enough that even an inactive user keeps their record around to
// see "your longest streak was N" on return.
const STREAK_TTL_SECONDS = 365 * 24 * 60 * 60;

export interface StreakState {
  current: number;
  longest: number;
  /** YYYY-MM-DD of the last day a submission was recorded. Null on first ever access. */
  lastSolvedDate: string | null;
}

function key(userId: string): string {
  return `${STREAK_KEY_PREFIX}${userId}`;
}

const EMPTY_STATE: StreakState = {
  current: 0,
  longest: 0,
  lastSolvedDate: null,
};

export async function getStreak(
  kv: KVNamespace,
  userId: string,
): Promise<StreakState> {
  const raw = await kv.get(key(userId));
  if (!raw) return { ...EMPTY_STATE };
  try {
    const parsed = JSON.parse(raw) as Partial<StreakState>;
    return {
      current: typeof parsed.current === 'number' ? parsed.current : 0,
      longest: typeof parsed.longest === 'number' ? parsed.longest : 0,
      lastSolvedDate:
        typeof parsed.lastSolvedDate === 'string' ? parsed.lastSolvedDate : null,
    };
  } catch {
    return { ...EMPTY_STATE };
  }
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
  const prior = await getStreak(kv, userId);

  // Idempotent: already recorded today, don't double-count.
  if (prior.lastSolvedDate === today) return prior;

  let nextCurrent: number;
  if (!correct) {
    nextCurrent = 0;
  } else if (prior.lastSolvedDate && isYesterday(prior.lastSolvedDate, today)) {
    nextCurrent = prior.current + 1;
  } else {
    // First-ever solve, or gap > 1 day. Start a new streak at 1.
    nextCurrent = 1;
  }

  const next: StreakState = {
    current: nextCurrent,
    longest: Math.max(nextCurrent, prior.longest),
    lastSolvedDate: today,
  };

  await kv.put(key(userId), JSON.stringify(next), {
    expirationTtl: STREAK_TTL_SECONDS,
  });
  return next;
}

function isYesterday(priorDate: string, today: string): boolean {
  const [py, pm, pd] = priorDate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const priorMs = Date.UTC(py, pm - 1, pd);
  const todayMs = Date.UTC(ty, tm - 1, td);
  return todayMs - priorMs === 24 * 60 * 60 * 1000;
}
