/**
 * What kind of practice problem to generate.
 *
 * Sits under "Try one like this →" and shapes only the problem the model
 * invents — the canonical example and a pasted problem are fixed text, so
 * there is nothing for it to do on those paths.
 *
 * Three buttons rather than the slider this replaced. A slider implies a
 * continuum, and these are not points on one: 'hard' is more to carry,
 * 'creative' is a different kind of problem entirely. Each carries its own
 * caption so the difference is legible without selecting them in turn.
 *
 * Unlike the model picker above it, this preference persists: it's a statement
 * about how a topic feels to this student, not a budget to spend deliberately
 * each time.
 */
import { T } from '../design/tokens';
import { kicker } from '../design/primitives';
import {
  DIFFICULTY_CAPTION,
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
  return (
    <div style={{ marginTop: 16 }}>
      <div style={kicker(8)}>Practice problem</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {DIFFICULTY_ORDER.map((level) => {
          const active = level === value;
          return (
            <button
              key={level}
              type="button"
              onClick={() => onChange(level)}
              disabled={disabled}
              // Matches the model picker directly above rather than radio
              // semantics, so two adjacent controls behave the same way.
              aria-pressed={active}
              className="btn-press"
              style={{
                flex: '1 1 140px',
                minHeight: 44,
                background: active ? T.ink : 'transparent',
                color: active ? T.paper : T.ink,
                border: `1px solid ${T.ink}`,
                padding: '9px 14px',
                textAlign: 'left',
                cursor: disabled ? 'not-allowed' : 'pointer',
                fontFamily: T.sans,
                opacity: disabled ? 0.6 : 1,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>
                {DIFFICULTY_LABEL[level]}
              </div>
              <div
                style={{
                  fontSize: 11,
                  fontFamily: T.mono,
                  letterSpacing: '0.06em',
                  opacity: 0.75,
                }}
              >
                {DIFFICULTY_CAPTION[level]}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
