import { useEffect, useMemo, useRef, useState } from 'react';
import { MathfieldElement, type Selector } from 'mathlive';
import katex from 'katex';
import 'katex/dist/katex.min.css';

// The katex stylesheet imported above is load-bearing twice over: it draws the
// keypad faces, and MathLive's loadFonts() bails out early as "ready" when all
// twelve KaTeX_* families are already registered on document.fonts. So the
// mathfield rides on KaTeX's fonts and never fetches its own — drop that import
// and the formulas silently fall back to a system serif.
// Sounds have no such fallback and nothing else here makes noise, so: off.
// It's a static, ignored once a mathfield exists, hence module scope.
MathfieldElement.soundsDirectory = null;

interface Key {
  /** LaTeX inserted at the cursor. `#?` marks where the caret lands after. */
  insert: string;
  /** LaTeX rendered as the key's face. */
  face: string;
  /** Screen-reader name — the rendered face is aria-hidden. */
  label: string;
}

/** Built rather than listed: 26 keys twice over is the one place here where
 *  spelling every entry out loses more than it documents. */
function letterKeys(upper: boolean): Key[] {
  return [...'abcdefghijklmnopqrstuvwxyz'].map((c) => {
    const ch = upper ? c.toUpperCase() : c;
    return { insert: ch, face: ch, label: upper ? `Capital ${c}` : c };
  });
}

const KEYPAD: { tab: string; keys: Key[]; shiftable?: true }[] = [
  {
    // A phone has no OS keyboard here, so this tab carries the whole of
    // `x^2 + 3x - 4 = 0` on its own: calculator digit order, the two
    // variables that turn up most, and an exponent so a quadratic doesn't
    // cost a trip to another tab.
    tab: '123',
    keys: [
      { insert: '7', face: '7', label: 'Seven' },
      { insert: '8', face: '8', label: 'Eight' },
      { insert: '9', face: '9', label: 'Nine' },
      { insert: 'x', face: 'x', label: 'x' },
      { insert: '^{#?}', face: 'x^n', label: 'Exponent' },
      { insert: '4', face: '4', label: 'Four' },
      { insert: '5', face: '5', label: 'Five' },
      { insert: '6', face: '6', label: 'Six' },
      { insert: 'y', face: 'y', label: 'y' },
      { insert: '\\frac{#?}{#?}', face: '\\frac{a}{b}', label: 'Fraction' },
      { insert: '1', face: '1', label: 'One' },
      { insert: '2', face: '2', label: 'Two' },
      { insert: '3', face: '3', label: 'Three' },
      { insert: '+', face: '+', label: 'Plus' },
      { insert: '-', face: '-', label: 'Minus' },
      { insert: '0', face: '0', label: 'Zero' },
      { insert: '.', face: '.', label: 'Decimal point' },
      { insert: '=', face: '=', label: 'Equals' },
      { insert: '(', face: '(', label: 'Open parenthesis' },
      { insert: ')', face: ')', label: 'Close parenthesis' },
    ],
  },
  {
    // Capitals are not decoration: a linear algebra student names matrices A
    // and B, and a discrete one writes A ∪ B. The Relations tab already has
    // the operators and had nothing to apply them to. A shift key rather than
    // a seventh tab — both cases at once is 52 keys, a screen and a half.
    tab: 'abc',
    keys: letterKeys(false),
    shiftable: true,
  },
  {
    tab: 'Basic',
    keys: [
      { insert: '\\frac{#?}{#?}', face: '\\frac{a}{b}', label: 'Fraction' },
      { insert: '^{#?}', face: 'x^n', label: 'Exponent' },
      { insert: '_{#?}', face: 'x_n', label: 'Subscript' },
      { insert: '\\sqrt{#?}', face: '\\sqrt{x}', label: 'Square root' },
      { insert: '\\sqrt[#?]{#?}', face: '\\sqrt[n]{x}', label: 'Nth root' },
      { insert: '\\left|#?\\right|', face: '|x|', label: 'Absolute value' },
      { insert: '\\left(#?\\right)', face: '(\\ )', label: 'Parentheses' },
      { insert: '\\pi', face: '\\pi', label: 'Pi' },
      { insert: 'e', face: 'e', label: 'e' },
      { insert: '\\infty', face: '\\infty', label: 'Infinity' },
      { insert: '\\times', face: '\\times', label: 'Times' },
      { insert: '\\div', face: '\\div', label: 'Divide' },
      { insert: '\\log_{#?}', face: '\\log_b', label: 'Logarithm' },
      { insert: '\\ln', face: '\\ln', label: 'Natural log' },
    ],
  },
  {
    tab: 'Calculus',
    keys: [
      { insert: '\\int #? \\,d#?', face: '\\int', label: 'Integral' },
      { insert: '\\int_{#?}^{#?} #? \\,d#?', face: '\\int_a^b', label: 'Definite integral' },
      { insert: '\\oint', face: '\\oint', label: 'Contour integral' },
      { insert: '\\frac{d}{d#?}', face: '\\frac{d}{dx}', label: 'Derivative' },
      { insert: '\\frac{\\partial}{\\partial #?}', face: '\\frac{\\partial}{\\partial x}', label: 'Partial derivative' },
      { insert: "'", face: "f'", label: 'Prime' },
      { insert: '\\sum_{#?}^{#?}', face: '\\sum', label: 'Sum' },
      { insert: '\\prod_{#?}^{#?}', face: '\\prod', label: 'Product' },
      { insert: '\\lim_{#?\\to#?}', face: '\\lim', label: 'Limit' },
      { insert: '\\nabla', face: '\\nabla', label: 'Nabla' },
      { insert: '\\binom{#?}{#?}', face: '\\binom{n}{k}', label: 'Binomial coefficient' },
      { insert: '#?!', face: 'n!', label: 'Factorial' },
    ],
  },
  {
    tab: 'Greek',
    keys: [
      { insert: '\\alpha', face: '\\alpha', label: 'Alpha' },
      { insert: '\\beta', face: '\\beta', label: 'Beta' },
      { insert: '\\gamma', face: '\\gamma', label: 'Gamma' },
      { insert: '\\delta', face: '\\delta', label: 'Delta' },
      { insert: '\\varepsilon', face: '\\varepsilon', label: 'Epsilon' },
      { insert: '\\theta', face: '\\theta', label: 'Theta' },
      { insert: '\\lambda', face: '\\lambda', label: 'Lambda' },
      { insert: '\\mu', face: '\\mu', label: 'Mu' },
      { insert: '\\rho', face: '\\rho', label: 'Rho' },
      { insert: '\\sigma', face: '\\sigma', label: 'Sigma' },
      { insert: '\\phi', face: '\\phi', label: 'Phi' },
      { insert: '\\omega', face: '\\omega', label: 'Omega' },
      { insert: '\\Delta', face: '\\Delta', label: 'Capital delta' },
      { insert: '\\Omega', face: '\\Omega', label: 'Capital omega' },
    ],
  },
  {
    tab: 'Relations',
    keys: [
      { insert: '\\le', face: '\\le', label: 'Less than or equal' },
      { insert: '\\ge', face: '\\ge', label: 'Greater than or equal' },
      { insert: '\\ne', face: '\\ne', label: 'Not equal' },
      { insert: '\\approx', face: '\\approx', label: 'Approximately' },
      { insert: '\\equiv', face: '\\equiv', label: 'Equivalent' },
      { insert: '\\pm', face: '\\pm', label: 'Plus or minus' },
      { insert: '\\in', face: '\\in', label: 'Element of' },
      { insert: '\\notin', face: '\\notin', label: 'Not an element of' },
      { insert: '\\subset', face: '\\subset', label: 'Subset' },
      { insert: '\\cup', face: '\\cup', label: 'Union' },
      { insert: '\\cap', face: '\\cap', label: 'Intersection' },
      { insert: '\\to', face: '\\to', label: 'Maps to' },
      { insert: '\\forall', face: '\\forall', label: 'For all' },
      { insert: '\\exists', face: '\\exists', label: 'There exists' },
    ],
  },
];

/** Caret and delete. Every tab can insert a `#?` placeholder — an exponent, a
 *  fraction, an integral — and a phone has no arrow key or backspace to get
 *  back out of one, so without these the field is write-only: tap Exponent
 *  once and the rest of the equation lands inside it. `moveToNextChar` steps
 *  out of a group when the caret is at its end, which is the escape. */
const NAV: { cmd: Selector; face?: string; word?: string; label: string }[] = [
  { cmd: 'moveToPreviousChar', face: '\\leftarrow', label: 'Move left' },
  { cmd: 'moveToNextChar', face: '\\rightarrow', label: 'Move right' },
  { cmd: 'deleteBackward', word: 'DEL', label: 'Delete' },
];

/** Key faces are our own constants, never user input — safe to inject. */
function renderFace(latex: string): string {
  return katex.renderToString(latex, { throwOnError: false, displayMode: false });
}

interface MathEntryProps {
  value: string;
  onChange: (latex: string) => void;
  onSubmit: () => void;
  onPasteImage: (file: File) => void;
  disabled: boolean;
}

export function MathEntry({ value, onChange, onSubmit, onPasteImage, disabled }: MathEntryProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const fieldRef = useRef<MathfieldElement | null>(null);
  const [tab, setTab] = useState(0);
  const [shift, setShift] = useState(false);

  // Keep the listeners reading the current callbacks without tearing down and
  // rebuilding the mathfield (which would drop the caret) on every render.
  const handlers = useRef({ onChange, onSubmit, onPasteImage });
  handlers.current = { onChange, onSubmit, onPasteImage };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const mf = new MathfieldElement();
    // Our own keypad covers the symbols, so MathLive's built-in virtual
    // keyboard would only be a second, differently-styled copy of it.
    mf.mathVirtualKeyboardPolicy = 'manual';
    // Lets a student type "integrate x^2" and have the prose stay prose.
    mf.smartMode = true;
    mf.setAttribute('placeholder', 'x^2 + 3x - 4 = 0');
    mf.value = value;
    host.appendChild(mf);
    fieldRef.current = mf;

    // Everything below has to wait for the append: MathLive builds its core on
    // connect, and touching menuItems before that throws "Mathfield not
    // mounted", which takes React's whole tree down with it.

    // No context menu: its entries (copy as MathML, change colour…) are a
    // different app's affordances, and it opens on right-click too.
    mf.menuItems = [];

    // MathLive also parks a keyboard toggle and a menu button inside the
    // field. Neither is exposed as a ::part, so reaching them means a
    // stylesheet adopted into its shadow root. The keyboard one would only
    // open a second, differently-styled copy of the keypad sitting below.
    // Constructable stylesheets reached Safari in 16.4; on anything older the
    // constructor throws, and thrown from this effect that is the whole
    // landing page gone. Those browsers keep the toggles instead.
    if (
      mf.shadowRoot &&
      typeof CSSStyleSheet !== 'undefined' &&
      'replaceSync' in CSSStyleSheet.prototype &&
      'adoptedStyleSheets' in mf.shadowRoot
    ) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('.ML__toggles { display: none; }');
      mf.shadowRoot.adoptedStyleSheets = [...mf.shadowRoot.adoptedStyleSheets, sheet];
    }

    const onInput = () => handlers.current.onChange(mf.value);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handlers.current.onSubmit();
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      for (const item of Array.from(e.clipboardData?.items ?? [])) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            handlers.current.onPasteImage(file);
            return;
          }
        }
      }
    };

    mf.addEventListener('input', onInput);
    mf.addEventListener('keydown', onKeyDown);
    mf.addEventListener('paste', onPaste);
    return () => {
      mf.removeEventListener('input', onInput);
      mf.removeEventListener('keydown', onKeyDown);
      mf.removeEventListener('paste', onPaste);
      mf.remove();
      fieldRef.current = null;
    };
    // Mount-only: `value` is synced by the effect below, and the handlers are
    // read through a ref, so nothing here should retrigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Outside writes (OCR, scanner) flow in here. Guarded so echoing our own
  // input event back into the field doesn't reset the caret mid-keystroke.
  useEffect(() => {
    const mf = fieldRef.current;
    if (mf && mf.value !== value) mf.value = value;
  }, [value]);

  useEffect(() => {
    const mf = fieldRef.current;
    if (mf) mf.readonly = disabled;
  }, [disabled]);

  function insert(latex: string) {
    const mf = fieldRef.current;
    if (!mf || disabled) return;
    mf.insert(latex, { focus: true, selectionMode: 'placeholder' });
    handlers.current.onChange(mf.value);
  }

  // Pressing the button took the focus off the field, and a command runs
  // against the caret — so it has to go back before the command, not after.
  function command(cmd: Selector) {
    const mf = fieldRef.current;
    if (!mf || disabled) return;
    mf.focus();
    mf.executeCommand(cmd);
    handlers.current.onChange(mf.value);
  }

  // Only the visible tab gets laid out. Rendering all six at mount is ~150
  // KaTeX calls on the landing page's critical path, and the letters have to
  // be re-rendered on shift regardless.
  const keys = useMemo(() => {
    const group = KEYPAD[tab];
    return group.shiftable && shift ? letterKeys(true) : group.keys;
  }, [tab, shift]);

  const faces = useMemo(() => keys.map((k) => renderFace(k.face)), [keys]);
  const navFaces = useMemo(() => NAV.map((n) => (n.face ? renderFace(n.face) : '')), []);

  return (
    <div className="math-entry">
      <div ref={hostRef} />

      <div className="math-keypad">
        {/* Above the tabs, so a six-row letters grid can never push the only
            way of correcting a typo off the bottom of the screen. */}
        <div className="math-keypad-nav" role="group" aria-label="Cursor and delete">
          {NAV.map((n, i) => (
            <button
              key={n.cmd}
              type="button"
              className={n.word ? 'math-keypad-key math-keypad-word' : 'math-keypad-key'}
              aria-label={n.label}
              disabled={disabled}
              onClick={() => command(n.cmd)}
            >
              {n.word ?? <span aria-hidden dangerouslySetInnerHTML={{ __html: navFaces[i] }} />}
            </button>
          ))}
        </div>

        <div className="math-keypad-tabs" role="tablist" aria-label="Math symbols">
          {KEYPAD.map((group, i) => (
            <button
              key={group.tab}
              type="button"
              role="tab"
              aria-selected={i === tab}
              className="math-keypad-tab"
              onClick={() => setTab(i)}
            >
              {group.tab}
            </button>
          ))}
        </div>

        <div className="math-keypad-grid" role="group" aria-label={`${KEYPAD[tab].tab} symbols`}>
          {/* Its own face is the state: "abc" while the letters below are
              lowercase, "ABC" once they aren't. */}
          {KEYPAD[tab].shiftable && (
            <button
              type="button"
              className="math-keypad-key math-keypad-word"
              aria-pressed={shift}
              disabled={disabled}
              onClick={() => setShift((s) => !s)}
            >
              {shift ? 'ABC' : 'abc'}
            </button>
          )}
          {keys.map((k, i) => (
            <button
              key={k.insert}
              type="button"
              className="math-keypad-key"
              aria-label={k.label}
              disabled={disabled}
              onClick={() => insert(k.insert)}
            >
              <span aria-hidden dangerouslySetInnerHTML={{ __html: faces[i] }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
