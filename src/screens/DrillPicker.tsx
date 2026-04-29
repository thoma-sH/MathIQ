import { useState } from 'react';
import { T } from '../design/tokens';
import { Kicker } from '../design/Kicker';
import { DRILLS } from '../drills';
import type { Domain } from '../math/types';
import type { Route } from '../router';

interface DrillPickerProps {
  onNavigate: (route: Route) => void;
}

const DOMAINS: Array<{ id: Domain; l: string; s: string }> = [
  { id: 'mixed',      l: 'Mixed',         s: 'across all domains' },
  { id: 'arithmetic', l: 'Arithmetic',    s: 'sums, products, percent' },
  { id: 'algebra',    l: 'Algebra',       s: 'powers, logs, linear' },
  { id: 'trig',       l: 'Trigonometry',  s: 'unit circle' },
  { id: 'calculus',   l: 'Calculus',      s: 'derivatives, integrals, limits' },
  { id: 'discrete',   l: 'Discrete',      s: 'gcd, mod, factorial' },
];

export function DrillPicker({ onNavigate }: DrillPickerProps) {
  const [domain, setDomain] = useState<Domain>('mixed');

  return (
    <main className="responsive-pad" style={{ padding: '40px 36px', maxWidth: 1440, margin: '0 auto' }}>
      <Kicker className="reveal reveal-1" style={{ marginBottom: 8 }}>DRILLS · FIVE WAYS TO TRAIN</Kicker>
      <h1 className="reveal reveal-2" style={{
        fontFamily: T.serif,
        fontSize: 'clamp(36px, 5vw, 64px)',
        lineHeight: 0.96,
        letterSpacing: '-0.03em',
        fontWeight: 400,
        margin: '0 0 12px',
        maxWidth: 900,
      }}>
        Pick your tempo.
      </h1>
      <p className="reveal reveal-3" style={{ fontSize: 16, opacity: 0.7, maxWidth: 620, marginBottom: 32 }}>
        Each mode is a different take on the same loop — generate, solve, learn. Pick one and a domain. Switch any time.
      </p>

      <Kicker className="reveal reveal-3" style={{ marginBottom: 10 }}>DOMAIN</Kicker>
      <div className="reveal reveal-4 stagger-children" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 36 }}>
        {DOMAINS.map((d) => (
          <button
            key={d.id}
            onClick={() => setDomain(d.id)}
            className="btn-press"
            style={{
              padding: '10px 16px',
              border: `1px solid ${domain === d.id ? T.ink : T.hair}`,
              background: domain === d.id ? T.ink : 'transparent',
              color: domain === d.id ? T.paper : T.ink,
              cursor: 'pointer',
              fontFamily: T.sans,
              fontSize: 13,
              transition: 'background 200ms, color 200ms, border-color 200ms',
            }}
          >
            <div style={{ fontWeight: 600 }}>{d.l}</div>
            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>{d.s}</div>
          </button>
        ))}
      </div>

      <div className="stagger-children" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {DRILLS.map((m) => (
          <button
            key={m.id}
            onClick={() => onNavigate({ name: 'drill', mode: m.id, domain })}
            className="lift btn-press"
            style={{
              background: T.paper,
              border: `1px solid ${T.hair}`,
              padding: 24,
              minHeight: 200,
              textAlign: 'left',
              cursor: 'pointer',
              position: 'relative',
              fontFamily: 'inherit',
              color: 'inherit',
              borderRadius: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
              <span style={{ fontFamily: T.mono, fontSize: 11, color: T.accent, letterSpacing: '0.15em' }}>{m.tag}</span>
              <span style={{ fontFamily: T.serif, fontSize: 32, lineHeight: 1 }}>{m.name}</span>
            </div>
            <Kicker>{m.kicker.toUpperCase()}</Kicker>
            <p style={{ fontSize: 13, opacity: 0.7, marginTop: 12, lineHeight: 1.5 }}>{m.description}</p>
            <span style={{
              position: 'absolute',
              bottom: 18,
              left: 24,
              fontSize: 13,
              fontWeight: 500,
              borderBottom: `1px solid ${T.ink}`,
            }}>
              Start <span className="arrow-nudge">→</span>
            </span>
          </button>
        ))}
      </div>
    </main>
  );
}
