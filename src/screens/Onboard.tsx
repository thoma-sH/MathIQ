import { useState } from 'react';
import { T } from '../design/tokens';
import { Kicker } from '../design/Kicker';
import type { Route } from '../router';
import type { Domain } from '../math/types';

interface OnboardProps {
  /**
   * Called with the route to navigate to once onboarding completes.
   * Either drops into a placement Pulse drill ("Begin probe") or jumps
   * to the home dashboard ("Skip").
   */
  onStart: (target: Route) => void;
}

interface Rung {
  l: string;
  sub: string;
  /** Domain to probe with if the user picks this rung. */
  domain: Domain;
}

const LADDER: Rung[] = [
  { l: 'Arithmetic',     sub: 'Mental sums, products, fractions',     domain: 'arithmetic' },
  { l: 'Pre-algebra',    sub: 'Order of ops, ratios, exponents',      domain: 'arithmetic' },
  { l: 'Algebra',        sub: 'Linear, quadratic, factoring',         domain: 'algebra' },
  { l: 'Geometry',       sub: 'Areas, angles, proofs',                domain: 'algebra' },
  { l: 'Trigonometry',   sub: 'Identities, unit circle',              domain: 'trig' },
  { l: 'Calculus',       sub: 'Derivatives, integrals, limits',       domain: 'calculus' },
  { l: 'Linear Algebra', sub: 'Matrices, vectors',                    domain: 'algebra' },
  { l: 'Statistics',     sub: 'Probability, distributions',           domain: 'discrete' },
];

export function Onboard({ onStart }: OnboardProps) {
  const [active, setActive] = useState(2);
  const selected = LADDER[active]!;

  const beginProbe = () =>
    onStart({ name: 'drill', mode: 'pulse', domain: selected.domain });
  const skip = () => onStart({ name: 'home' });

  return (
    <div className="grid-onboard" style={{
      minHeight: '100vh',
      background: T.paper,
      color: T.ink,
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
    }}>
      <div className="responsive-pad" style={{ padding: '64px 56px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <Kicker className="reveal reveal-1">STEP 02 · CALIBRATE</Kicker>
          <h1 className="reveal reveal-2" style={{
            fontFamily: T.serif,
            fontSize: 'clamp(40px, 6vw, 76px)',
            lineHeight: 0.95,
            letterSpacing: '-0.03em',
            fontWeight: 400,
            margin: '24px 0 16px',
          }}>
            Where does your<br />head live now?
          </h1>
          <p className="reveal reveal-3" style={{ fontSize: 17, lineHeight: 1.5, opacity: 0.7, maxWidth: 480 }}>
            Pick the level you're most comfortable doing without paper. We'll calibrate from there with a 60-second probe.
          </p>
        </div>
        <div className="reveal reveal-4" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 32 }}>
          <button onClick={beginProbe} className="btn-press lift" style={{
            background: T.ink,
            color: T.paper,
            border: 'none',
            padding: '14px 26px',
            fontSize: 15,
            cursor: 'pointer',
          }}>
            Begin probe <span className="arrow-nudge">→</span>
          </button>
          <button onClick={skip} className="btn-press" style={{
            background: 'transparent',
            color: T.ink,
            border: 'none',
            padding: '14px 18px',
            fontSize: 15,
            opacity: 0.7,
            cursor: 'pointer',
          }}>
            Skip, I'll just play
          </button>
        </div>
      </div>
      <div className="responsive-pad" style={{ background: T.ink, color: T.paper, padding: '64px 48px', display: 'flex', flexDirection: 'column' }}>
        <Kicker color="rgba(244,239,230,0.5)" className="reveal reveal-1" style={{ marginBottom: 24 }}>
          SELECT YOUR FLOOR
        </Kicker>
        <div className="stagger-children">
          {LADDER.map((r, i) => (
            <div
              key={i}
              onClick={() => setActive(i)}
              className="btn-press"
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                padding: '14px 0',
                borderBottom: '1px solid rgba(244,239,230,0.08)',
                cursor: 'pointer',
                opacity: i === active ? 1 : 0.5,
                paddingLeft: i === active ? 16 : 0,
                transition: 'all 220ms var(--ease-out-expo)',
              }}
            >
              <div>
                <div style={{ fontFamily: T.serif, fontSize: 28, lineHeight: 1 }}>
                  {i === active && <span style={{ color: T.accent, marginRight: 12 }}>●</span>}
                  {r.l}
                </div>
                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{r.sub}</div>
              </div>
              <div style={{ fontFamily: T.mono, fontSize: 11, opacity: 0.5 }}>L{String(i + 1).padStart(2, '0')}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
