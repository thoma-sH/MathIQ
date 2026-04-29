import type { Domain } from '../math/types';

export const DRILL_MODES = ['pulse', 'stream', 'voice', 'layers', 'arena'] as const;
export type DrillMode = (typeof DRILL_MODES)[number];

export interface DrillResult {
  mode: string;
  solved: number;
  streak?: number;
  durationSec?: number;
  /** Arena-only. */
  youScore?: number;
  /** Arena-only. */
  aiScore?: number;
}

export interface DrillProps {
  domain: Domain;
  onExit: () => void;
  onComplete: (result: DrillResult) => void;
  /** From tweaks.drillTimer; in seconds. Drills decide whether to honor it. */
  drillTimer: number;
}
