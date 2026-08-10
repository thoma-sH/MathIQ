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
  /** True once entitlement is actually known. Until then `canChoose` is just
   *  its default of false, which is indistinguishable from a settled free
   *  user — so the picker must not act on it. */
  ready: boolean;
  /** Max walkthroughs left today. Undefined while the count is still loading. */
  maxRemaining?: number;
  onLocked: () => void;
  disabled?: boolean;
}

export function ModelPicker({
  value,
  onChange,
  canChoose,
  ready,
  maxRemaining,
  onLocked,
  disabled = false,
}: ModelPickerProps) {
  // No budget left today — Max would silently serve Sonnet, so don't offer it.
  const maxExhausted = canChoose && maxRemaining === 0;

  // Max is Opus on every tier, so that half stays honest while we wait. Which
  // model "Standard" means does depend on tier, so it holds until we know.
  const maxSublabel = !ready
    ? 'Opus 4.6'
    : !canChoose
      ? 'Plus or Pro'
      : maxRemaining === undefined
        ? 'Opus 4.6'
        : maxExhausted
          ? 'None left today'
          : `Opus 4.6 · ${maxRemaining} left`;

  function pick(next: ModelChoice) {
    // Entitlement still in flight. A click here would open the upgrade modal
    // for a paid user, which then closes itself the instant the real tier
    // lands — the phantom popup. Do nothing until we actually know.
    if (!ready) return;
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
        {/* Standard reads as selected even when locked — it's genuinely what
            will run, so leaving both chips blank would look like an unmade
            choice rather than an unavailable one. */}
        <ModelChip
          active={value === 'standard'}
          onClick={() => pick('standard')}
          label="Standard"
          sublabel={!ready ? '…' : canChoose ? 'Sonnet 4.6' : 'Haiku 4.5'}
          locked={false}
          disabled={disabled}
        />
        {/* Unknown entitlement must not render as locked — that's what invites
            the click that opens a modal we're about to close again. */}
        <ModelChip
          active={canChoose && value === 'max'}
          onClick={() => pick('max')}
          label="Max"
          sublabel={maxSublabel}
          locked={ready && (!canChoose || maxExhausted)}
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
