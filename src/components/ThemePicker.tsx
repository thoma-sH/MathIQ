/**
 * A grid of palette swatches.
 *
 * Each card carries `data-theme={id}`, and because the theme blocks in
 * index.css are unscoped attribute selectors, that alone re-points every token
 * inside the card. The preview is therefore the real palette rendering real
 * chrome — a miniature of the app, not a hand-maintained approximation that
 * drifts the first time a color changes.
 */
import { T } from '../design/tokens';
import { THEME_LABEL, type ThemeId } from '../design/palettes';

interface ThemePickerProps {
  themes: ThemeId[];
  /** The palette chosen for this group, ticked even when the other group is live. */
  value: ThemeId;
  onChange: (next: ThemeId) => void;
}

export function ThemePicker({ themes, value, onChange }: ThemePickerProps) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
      {themes.map((id) => (
        <Swatch
          key={id}
          id={id}
          active={id === value}
          onClick={() => onChange(id)}
        />
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
        // Two per row at 375px, three once there is room.
        flex: '1 1 128px',
        minHeight: 44,
        // Every color below resolves against this card's own data-theme.
        background: T.paper,
        border: `1px solid ${active ? T.ink : T.hair}`,
        outline: active ? `2px solid ${T.ink}` : 'none',
        outlineOffset: -4,
        padding: 0,
        cursor: 'pointer',
        fontFamily: T.sans,
        overflow: 'hidden',
        textAlign: 'left',
      }}
    >
      {/* A miniature of the app: a filled card, a rule, and the accent. */}
      <span
        aria-hidden
        style={{
          display: 'flex',
          alignItems: 'stretch',
          height: 26,
          background: T.paper2,
          borderBottom: `1px solid ${T.hair}`,
        }}
      >
        <span style={{ flex: 1, display: 'flex', alignItems: 'center', paddingLeft: 8, gap: 4 }}>
          <span style={{ width: 22, height: 3, background: T.ink }} />
          <span style={{ width: 12, height: 3, background: T.muted }} />
        </span>
        <span style={{ width: 26, background: T.accent }} />
      </span>
      <span
        style={{
          display: 'block',
          padding: '7px 9px 8px',
          fontSize: 12,
          fontWeight: 600,
          color: T.ink,
          lineHeight: 1.2,
        }}
      >
        {THEME_LABEL[id]}
      </span>
    </button>
  );
}
