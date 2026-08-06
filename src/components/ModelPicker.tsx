/**
 * Standard / Max model choice for a single walkthrough.
 *
 * The point of this control is conservation: paid users get a small number of
 * Max walkthroughs a day, and without a choice they'd be spent on whatever
 * problem happened to come first. So the choice is per-problem and always
 * starts on Standard — Max is opt-in, every time.
 *
 * Free and anonymous users see the control locked rather than hidden; it's the
 * clearest moment to explain what paying buys.
 */
import { T } from '../design/tokens';
import type { ModelChoice } from '../walkthroughs/generate';

interface ModelPickerProps {
  value: ModelChoice;
  onChange: (next: ModelChoice) => void;
  /** False for free/anonymous — chips render locked and clicks call onLocked. */
  canChoose: boolean;
  /** Max walkthroughs left today. Undefined while the count is still loading. */
  maxRemaining?: number;
  onLocked: () => void;
  disabled?: boolean;
}

export function ModelPicker({
  value,
  onChange,
  canChoose,
  maxRemaining,
  onLocked,
  disabled = false,
}: ModelPickerProps) {
  // No budget left today — Max would silently serve Sonnet, so don't offer it.
  const maxExhausted = canChoose && maxRemaining === 0;

  const maxSublabel = !canChoose
    ? 'Plus or Pro'
    : maxRemaining === undefined
      ? 'Opus 4.6'
      : maxExhausted
        ? 'None left today'
        : `Opus 4.6 · ${maxRemaining} left`;

  function pick(next: ModelChoice) {
    if (!canChoose) {
      onLocked();
      return;
    }
    if (next === 'max' && maxExhausted) return;
    onChange(next);
  }

  return (
    <div style={{ marginTop: 10, marginBottom: 12 }}>
      <div
        style={{
          fontSize: 11,
          fontFamily: T.mono,
          letterSpacing: '0.14em',
          color: T.muted,
          textTransform: 'uppercase',
          marginBottom: 8,
        }}
      >
        Model
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <ModelChip
          active={canChoose && value === 'standard'}
          onClick={() => pick('standard')}
          label="Standard"
          sublabel={canChoose ? 'Sonnet 4.6' : 'Haiku 4.5'}
          locked={false}
          disabled={disabled}
        />
        <ModelChip
          active={canChoose && value === 'max'}
          onClick={() => pick('max')}
          label="Max"
          sublabel={maxSublabel}
          locked={!canChoose || maxExhausted}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

function ModelChip({
  active,
  onClick,
  label,
  sublabel,
  locked,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sublabel: string;
  locked: boolean;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className="btn-press"
      style={{
        flex: '1 1 140px',
        minHeight: 44,
        background: active ? T.ink : 'transparent',
        color: active ? T.paper : locked ? T.muted : T.ink,
        border: `1px solid ${active || !locked ? T.ink : T.hairStrong}`,
        padding: '9px 14px',
        textAlign: 'left',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: T.sans,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 11, fontFamily: T.mono, letterSpacing: '0.06em', opacity: 0.75 }}>
        {sublabel}
      </div>
    </button>
  );
}
