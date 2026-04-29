/**
 * Session-stats store. In-memory only — every reload resets to a clean
 * "first-time user" state. Within a session, drill completions accumulate
 * into running totals, best streaks, fastest answers, etc.
 */
import { useCallback, useState } from 'react';
import type { DrillResult } from '../drills/types';

export interface SessionStats {
  streak: number;
  streakBest: number;
  solvedToday: number;
  totalSolved: number;
  sessionsToday: number;
  fastestAnswerSec: number | null;
  fastestProblem: string | null;
  hardestSolved: string | null;
  /** Win/loss against AI in Arena. */
  arenaWins: number;
  arenaLosses: number;
  lastSeenDate: string;
}

const today = () => new Date().toISOString().slice(0, 10);

const DEFAULT_STATS: SessionStats = {
  streak: 0,
  streakBest: 0,
  solvedToday: 0,
  totalSolved: 0,
  sessionsToday: 0,
  fastestAnswerSec: null,
  fastestProblem: null,
  hardestSolved: null,
  arenaWins: 0,
  arenaLosses: 0,
  lastSeenDate: today(),
};

export function useStats() {
  const [stats, setStats] = useState<SessionStats>(DEFAULT_STATS);

  /**
   * Fold a completed DrillResult into the running session stats.
   * Tracks: solved totals, best streak, sessions count, arena W/L,
   * fastest answer (rough — uses overall durationSec / solved as a
   * lower-bound until per-problem timing is wired through).
   */
  const recordDrillResult = useCallback((result: DrillResult) => {
    setStats((s) => {
      const next: SessionStats = {
        ...s,
        solvedToday: s.solvedToday + result.solved,
        totalSolved: s.totalSolved + result.solved,
        sessionsToday: s.sessionsToday + 1,
        streak: result.streak ?? s.streak,
        streakBest: Math.max(s.streakBest, result.streak ?? 0),
        lastSeenDate: today(),
      };

      // Arena win/loss tracking.
      if (typeof result.youScore === 'number' && typeof result.aiScore === 'number') {
        if (result.youScore > result.aiScore) next.arenaWins = s.arenaWins + 1;
        else if (result.youScore < result.aiScore) next.arenaLosses = s.arenaLosses + 1;
      }

      // Fastest answer estimate.
      if (result.solved > 0 && result.durationSec && result.durationSec > 0) {
        const avg = result.durationSec / result.solved;
        if (s.fastestAnswerSec == null || avg < s.fastestAnswerSec) {
          next.fastestAnswerSec = avg;
          next.fastestProblem = `${result.mode} run`;
        }
      }

      return next;
    });
  }, []);

  return { stats, recordDrillResult };
}
