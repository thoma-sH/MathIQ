import { T } from './tokens';

interface SizedIconProps {
  /** CSS size string (e.g. "1em", "18px"). Defaults to "1em" so the icon
   *  scales with surrounding text. */
  size?: string;
}

export function CheckIcon({ size = '1em' }: SizedIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden
      style={{ display: 'inline-block', verticalAlign: '-0.125em' }}
    >
      <path
        d="M3 8.5 L6.5 12 L13 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function CrossIcon({ size = '1em' }: SizedIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden
      style={{ display: 'inline-block', verticalAlign: '-0.125em' }}
    >
      <path
        d="M4 4 L12 12 M12 4 L4 12"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export type DifficultyTier = 'easy' | 'mid' | 'hard' | 'cumulative';

const DIFFICULTY_FILL: Record<DifficultyTier, string> = {
  easy: T.accent3,
  mid: T.accent2,
  hard: T.accent,
  cumulative: T.ink,
};

const DIFFICULTY_LABEL: Record<DifficultyTier, string> = {
  easy: 'EASY',
  mid: 'MID',
  hard: 'HARD',
  cumulative: 'SUNDAY',
};

/** Small circular dot with hairline ink border. Color escalates with difficulty
 *  along the existing pistachio palette — no new colors introduced. */
export function DifficultyDot({ tier }: { tier: DifficultyTier }) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: '0.7em',
        height: '0.7em',
        borderRadius: '50%',
        background: DIFFICULTY_FILL[tier],
        border: `1px solid ${T.ink}`,
        verticalAlign: '-0.05em',
        flexShrink: 0,
      }}
    />
  );
}

/** Inline dot + uppercase label. The default chip shape used inside kicker rows. */
export function DifficultyChip({ tier }: { tier: DifficultyTier }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <DifficultyDot tier={tier} />
      <span>{DIFFICULTY_LABEL[tier]}</span>
    </span>
  );
}

export const difficultyLabel = (tier: DifficultyTier): string => DIFFICULTY_LABEL[tier];
