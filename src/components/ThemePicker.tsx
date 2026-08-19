/**
 * A grid of palette swatches.
 *
 * Each card carries `data-theme={id}`, and because the theme blocks in
 * index.css are unscoped attribute selectors, that alone re-points every token
 * inside the card. So the swatch isn't a row of color chips — it is a
 * miniature walkthrough screen wearing the palette it advertises: kicker,
 * heading, a filled card, the two CTAs, the accent. What you see is what the
 * app becomes, and it can never drift, because there is no second copy of the
 * colors to drift from.
 */
import { T } from '../design/tokens';
import { CheckIcon } from '../design/icons';
import { THEME_LABEL, type ThemeId } from '../design/palettes';

interface ThemePickerProps {
  themes: ThemeId[];
  /** The palette chosen for this group, ticked even when the other group is live. */
  value: ThemeId;
  onChange: (next: ThemeId) => void;
}

export function ThemePicker({ themes, value, onChange }: ThemePickerProps) {
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
      {themes.map((id) => (
        <Swatch key={id} id={id} active={id === value} onClick={() => onChange(id)} />
      ))}
    </div>
  );
}

function Swatch({
  id,
  active,
  onClick,
}: {
  id: ThemeId;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-theme={id}
      onClick={onClick}
      aria-pressed={active}
      aria-label={THEME_LABEL[id]}
      className="btn-press"
      style={{
        // One column at 375px so the miniature stays legible; two or three
        // once there is room for them.
        flex: '1 1 232px',
        // Every color below resolves against this card's own data-theme.
        background: T.paper,
        border: `1px solid ${T.ink}`,
        outline: active ? `2px solid ${T.ink}` : 'none',
        outlineOffset: 2,
        padding: 0,
        cursor: 'pointer',
        fontFamily: T.sans,
        textAlign: 'left',
        overflow: 'hidden',
      }}
    >
      <span aria-hidden style={{ display: 'block', padding: '12px 13px 11px' }}>
        <span
          style={{
            display: 'block',
            fontFamily: T.mono,
            fontSize: 8,
            letterSpacing: '0.14em',
            color: T.muted,
            marginBottom: 5,
          }}
        >
          STRATEGIC ANCHOR
        </span>
        <span
          style={{
            display: 'block',
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            lineHeight: 1.05,
            color: T.ink,
            marginBottom: 8,
          }}
        >
          Bounded Sequences
        </span>

        {/* The filled card — the surface slot doing its actual job. */}
        <span
          style={{
            display: 'block',
            background: T.paper2,
            border: `1px solid ${T.hair}`,
            padding: '7px 9px',
            marginBottom: 9,
          }}
        >
          <span style={{ display: 'block', height: 3, background: T.ink, width: '82%' }} />
          <span
            style={{
              display: 'block',
              height: 3,
              background: T.muted,
              width: '54%',
              marginTop: 4,
            }}
          />
        </span>

        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span
            className="chamfer"
            style={{
              background: T.ink,
              color: T.paper,
              fontSize: 10,
              fontWeight: 600,
              padding: '6px 9px',
              whiteSpace: 'nowrap',
            }}
          >
            Walk me through it
          </span>
          <span
            className="chamfer"
            style={{
              border: `1px solid ${T.ink}`,
              color: T.ink,
              fontSize: 10,
              padding: '5px 8px',
              whiteSpace: 'nowrap',
            }}
          >
            Try one
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ width: 14, height: 14, background: T.accent }} />
          <span style={{ width: 14, height: 14, background: T.accent3 }} />
        </span>
      </span>

      {/* Name plate, in the palette's own surface so the card reads as one piece. */}
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          background: T.paper2,
          borderTop: `1px solid ${T.hair}`,
          padding: '8px 11px',
          fontSize: 13,
          fontWeight: 600,
          color: T.ink,
          minHeight: 36,
        }}
      >
        {THEME_LABEL[id]}
        {active && (
          <span style={{ display: 'inline-flex', color: T.ink }}>
            <CheckIcon size="14px" />
          </span>
        )}
      </span>
    </button>
  );
}
