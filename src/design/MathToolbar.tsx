/**
 * MathToolbar — Symbolab-style row of math-symbol insert buttons that
 * sit above (or beside) any answer input. Each button inserts its glyph
 * at the current caret position in the bound input and restores focus
 * + caret state, so the user can fluently type "√2/2" or "13²" without
 * leaving the keyboard mental model.
 *
 * Usage:
 *   const ref = useRef<HTMLInputElement>(null);
 *   <MathToolbar inputRef={ref} value={answer} onChange={setAnswer} />
 *   <input ref={ref} value={answer} onChange={(e) => setAnswer(e.target.value)} />
 *
 * The toolbar is purely a controller — it doesn't render the input. That
 * keeps each drill free to style its own answer field however it wants.
 */
import { useCallback, type CSSProperties, type RefObject } from 'react';
import { T } from './tokens';

export interface MathSymbol {
  /** What the user sees on the button. */
  display: string;
  /** What gets inserted into the input. Defaults to display. */
  insert?: string;
  /** Accessible label. */
  label?: string;
  /** Special action (overrides insert). */
  action?: 'backspace' | 'clear';
}

export const DEFAULT_SYMBOLS: MathSymbol[] = [
  { display: '√', label: 'square root' },
  { display: '²', label: 'squared' },
  { display: '³', label: 'cubed' },
  { display: 'π', label: 'pi' },
  { display: '°', label: 'degrees' },
  { display: '/', label: 'divide' },
  { display: '×', label: 'multiply' },
  { display: '−', label: 'minus' },
  { display: '(', label: 'open paren' },
  { display: ')', label: 'close paren' },
  { display: '⌫', action: 'backspace', label: 'backspace' },
];

interface ToolbarVariant {
  bg: string;
  fg: string;
  border: string;
  hoverBg: string;
}

const VARIANTS: Record<'editorial' | 'dark' | 'soft', ToolbarVariant> = {
  editorial: {
    bg: 'transparent',
    fg: T.ink,
    border: T.hairStrong,
    hoverBg: 'rgba(22,17,10,0.06)',
  },
  dark: {
    bg: 'rgba(255,255,255,0.04)',
    fg: '#fff',
    border: 'rgba(255,255,255,0.18)',
    hoverBg: 'rgba(255,255,255,0.12)',
  },
  soft: {
    bg: '#fff',
    fg: '#1f2a1f',
    border: '#1f2a1f30',
    hoverBg: '#1f2a1f12',
  },
};

interface MathToolbarProps {
  inputRef: RefObject<HTMLInputElement>;
  value: string;
  onChange: (next: string) => void;
  symbols?: MathSymbol[];
  variant?: keyof typeof VARIANTS;
  style?: CSSProperties;
  /** Hide the toolbar; useful for hands-free / voice contexts. */
  hidden?: boolean;
}

export function MathToolbar({
  inputRef,
  value,
  onChange,
  symbols = DEFAULT_SYMBOLS,
  variant = 'editorial',
  style,
  hidden,
}: MathToolbarProps) {
  const v = VARIANTS[variant];

  const apply = useCallback(
    (sym: MathSymbol) => {
      const el = inputRef.current;
      const start = el?.selectionStart ?? value.length;
      const end = el?.selectionEnd ?? value.length;

      let nextValue = value;
      let nextCaret = start;

      if (sym.action === 'backspace') {
        if (start === end && start > 0) {
          // Caret with no selection: delete the character to the left.
          nextValue = value.slice(0, start - 1) + value.slice(end);
          nextCaret = start - 1;
        } else if (start !== end) {
          // Selection: delete it.
          nextValue = value.slice(0, start) + value.slice(end);
          nextCaret = start;
        }
      } else if (sym.action === 'clear') {
        nextValue = '';
        nextCaret = 0;
      } else {
        const insert = sym.insert ?? sym.display;
        nextValue = value.slice(0, start) + insert + value.slice(end);
        nextCaret = start + insert.length;
      }

      onChange(nextValue);

      // React commits the new value asynchronously; restore caret + focus
      // on the next frame so the input shows the cursor in the right spot.
      requestAnimationFrame(() => {
        if (!el) return;
        el.focus();
        try {
          el.setSelectionRange(nextCaret, nextCaret);
        } catch {
          // ignore (some input types don't support setSelectionRange)
        }
      });
    },
    [inputRef, onChange, value],
  );

  if (hidden) return null;

  return (
    <div
      className="math-toolbar no-scrollbar"
      role="toolbar"
      aria-label="Math input"
      style={{
        display: 'flex',
        gap: 4,
        overflowX: 'auto',
        padding: 4,
        background: v.bg,
        border: `1px solid ${v.border}`,
        borderBottom: 'none',
        ...style,
      }}
    >
      {symbols.map((s, i) => (
        <button
          key={`${s.display}-${i}`}
          type="button"
          aria-label={s.label ?? s.display}
          onMouseDown={(e) => e.preventDefault()} // don't lose focus on click
          onClick={() => apply(s)}
          className="btn-press"
          style={{
            minWidth: 36,
            height: 32,
            padding: '0 8px',
            background: 'transparent',
            color: v.fg,
            border: 'none',
            borderRadius: 2,
            cursor: 'pointer',
            fontFamily: T.serif,
            fontSize: 18,
            lineHeight: 1,
            transition: 'background 140ms',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = v.hoverBg)}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          {s.display}
        </button>
      ))}
    </div>
  );
}
