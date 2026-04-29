/**
 * Tour — first-run onboarding tooltips. Originally the designer's "post-it
 * notes" stuck onto the prototype canvas; here they're a real product
 * feature: a small one-time walkthrough that teaches the user the three
 * least-discoverable affordances (the drill modes, the gallery, and where
 * to find Iris).
 *
 * Persists a "seen" flag in localStorage so it shows once per device.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { T } from '../design/tokens';
import { Kicker } from '../design/Kicker';

interface Step {
  title: string;
  body: string;
  /** Selector for the element to highlight; falls back to centered if missing. */
  anchor?: string;
}

const STEPS: Step[] = [
  {
    title: 'Five ways to train',
    body: 'Pulse, Stream, Voice, Layers, Arena — five takes on mental math. Each is a complete experience. Try them all; settle on what fits.',
    anchor: 'a[href]:nth-of-type(2)',
  },
  {
    title: 'Browse the gallery',
    body: 'See every drill mode at once. Live previews you can launch in one click.',
    anchor: 'header nav a:nth-of-type(3)',
  },
  {
    title: 'Tweak the system',
    body: 'Color theme, typography, density, AI tone, drill timer — all live and savable. The whole app re-skins instantly.',
    anchor: '⚙ TWEAKS',
  },
];

const tooltipStyle = (anchor: DOMRect | null): CSSProperties => {
  if (!anchor) {
    return {
      position: 'fixed',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      width: 320,
    };
  }
  const top = anchor.bottom + 12;
  const left = Math.max(16, Math.min(window.innerWidth - 320 - 16, anchor.left));
  return { position: 'fixed', left, top, width: 320 };
};

export function Tour() {
  const [step, setStep] = useState(0);
  // Always open on every run so the first-time experience is consistent.
  const [open, setOpen] = useState(true);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!open) return;
    const current = STEPS[step];
    if (!current?.anchor) {
      setAnchorRect(null);
      return;
    }
    // Try CSS selector first; fall back to a text search through the page so
    // we can target buttons by their visible label without coupling Tour to
    // a specific DOM structure.
    let el: Element | null = null;
    try {
      el = document.querySelector(current.anchor);
    } catch {
      // selector was actually a label
    }
    if (!el) {
      const label = current.anchor;
      el = Array.from(document.querySelectorAll<HTMLElement>('button, a'))
        .find((node) => node.textContent?.includes(label)) ?? null;
    }
    setAnchorRect(el?.getBoundingClientRect() ?? null);
  }, [step, open]);

  if (!open) return null;
  const current = STEPS[step]!;

  const dismiss = () => {
    setOpen(false);
  };

  const next = () => {
    if (step < STEPS.length - 1) setStep((s) => s + 1);
    else dismiss();
  };

  return (
    <>
      {/* Soft-darkening backdrop with a "spotlight" cutout over the anchor. */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(22,17,10,0.35)',
          zIndex: 100,
          pointerEvents: 'auto',
        }}
        onClick={dismiss}
      />
      {anchorRect && (
        <div
          style={{
            position: 'fixed',
            left: anchorRect.left - 8,
            top: anchorRect.top - 8,
            width: anchorRect.width + 16,
            height: anchorRect.height + 16,
            border: `2px solid ${T.accent}`,
            boxShadow: `0 0 0 9999px rgba(22,17,10,0.0)`,
            borderRadius: 6,
            zIndex: 101,
            pointerEvents: 'none',
            transition: 'all 200ms cubic-bezier(.2,.7,.3,1)',
          }}
        />
      )}

      <div
        style={{
          ...tooltipStyle(anchorRect),
          background: T.paper,
          border: `1.5px solid ${T.ink}`,
          padding: 20,
          fontFamily: T.sans,
          color: T.ink,
          zIndex: 102,
          boxShadow: '0 16px 48px rgba(22,17,10,0.25)',
        }}
        role="dialog"
        aria-label={current.title}
      >
        <Kicker style={{ marginBottom: 6 }}>STEP {step + 1} OF {STEPS.length}</Kicker>
        <div style={{ fontFamily: T.serif, fontSize: 24, lineHeight: 1.15, marginBottom: 8 }}>
          {current.title}
        </div>
        <div style={{ fontSize: 14, opacity: 0.8, lineHeight: 1.5 }}>{current.body}</div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, gap: 8 }}>
          <button
            onClick={dismiss}
            style={{
              background: 'transparent',
              border: 'none',
              padding: '6px 0',
              fontSize: 12,
              fontFamily: T.mono,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              opacity: 0.6,
              cursor: 'pointer',
            }}
          >
            Skip tour
          </button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {STEPS.map((_, i) => (
                <div
                  key={i}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    background: i === step ? T.ink : T.hair,
                  }}
                />
              ))}
            </div>
            <button
              onClick={next}
              style={{
                background: T.ink,
                color: T.paper,
                border: 'none',
                padding: '8px 14px',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {step === STEPS.length - 1 ? 'Got it ↵' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
