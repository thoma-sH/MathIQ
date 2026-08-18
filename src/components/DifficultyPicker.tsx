/**
 * Difficulty slider for generated practice problems.
 *
 * Sits under "Try one like this →" and shapes only the problem the model
 * invents — the canonical example and a pasted problem are fixed text, so
 * there is nothing for a difficulty dial to do on those paths.
 *
 * Unlike the model picker next to it, this preference persists: it's a
 * statement about how a topic feels to this student, not a budget to spend
 * deliberately each time.
 */
import { T } from '../design/tokens';
import { kicker } from '../design/primitives';
import {
  DIFFICULTY_HINT,
  DIFFICULTY_LABEL,
  DIFFICULTY_ORDER,
  type PracticeDifficulty,
} from '../state/practiceDifficulty';

interface DifficultyPickerProps {
  value: PracticeDifficulty;
  onChange: (next: PracticeDifficulty) => void;
  disabled?: boolean;
}

export function DifficultyPicker({
  value,
  onChange,
  disabled = false,
}: DifficultyPickerProps) {
  const index = Math.max(0, DIFFICULTY_ORDER.indexOf(value));

  return (
    <div style={{ marginTop: 16, maxWidth: 320 }}>
      <div style={kicker(2)}>Practice difficulty</div>
      <input
        type="range"
        className="difficulty-slider"
        min={0}
        max={DIFFICULTY_ORDER.length - 1}
        step={1}
        value={index}
        disabled={disabled}
        onChange={(e) => onChange(DIFFICULTY_ORDER[Number(e.target.value)])}
        aria-label="Practice problem difficulty"
        // Without this, screen readers announce the raw index ("1").
        aria-valuetext={DIFFICULTY_LABEL[value]}
      />
      <div className="difficulty-ticks" aria-hidden="true">
        {DIFFICULTY_ORDER.map((d) => (
          <span key={d} data-active={d === value}>
            {DIFFICULTY_LABEL[d]}
          </span>
        ))}
      </div>
      <div
        style={{
          fontSize: 12,
          color: T.muted,
          lineHeight: 1.45,
          marginTop: 8,
          fontFamily: T.sans,
        }}
      >
        {DIFFICULTY_HINT[value]}
      </div>
    </div>
  );
}
