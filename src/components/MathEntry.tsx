import { useEffect, useMemo, useRef, useState } from 'react';
import { MathfieldElement } from 'mathlive';
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

const KEYPAD: { tab: string; keys: Key[] }[] = [
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

  const faces = useMemo(
    () => KEYPAD.map((group) => group.keys.map((k) => renderFace(k.face))),
    [],
  );

  return (
    <div className="math-entry">
      <div ref={hostRef} />

      <div className="math-keypad">
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
          {KEYPAD[tab].keys.map((k, i) => (
            <button
              key={k.insert}
              type="button"
              className="math-keypad-key"
              aria-label={k.label}
              disabled={disabled}
              onClick={() => insert(k.insert)}
            >
              <span aria-hidden dangerouslySetInnerHTML={{ __html: faces[tab][i] }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
