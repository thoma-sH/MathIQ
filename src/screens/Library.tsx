import { useState } from 'react';
import { T } from '../design/tokens';
import { Kicker } from '../design/Kicker';
import { chipBtn } from '../design/buttons';
import type { Domain } from '../math/types';
import type { DrillMode } from '../drills/types';
import type { Route } from '../router';

interface LibraryProps {
  onNavigate: (route: Route) => void;
}

interface Track {
  name: string;
  items: number;
  done: number;
  tag?: string;
  accent?: string;
  mode: DrillMode;
  domain: Domain;
}

const TRACKS: Track[] = [
  { name: 'Mental arithmetic',     items: 24, done: 0, tag: 'START HERE', accent: T.accent, mode: 'pulse',  domain: 'arithmetic' },
  { name: 'Algebra fluency',       items: 32, done: 0,                                       mode: 'stream', domain: 'algebra' },
  { name: 'Geometry intuition',    items: 18, done: 0,                                       mode: 'layers', domain: 'algebra' },
  { name: 'Trig flash',            items: 22, done: 0,                                       mode: 'pulse',  domain: 'trig' },
  { name: 'Calculus reflexes',     items: 28, done: 0,                                       mode: 'stream', domain: 'calculus' },
  { name: 'Probability tables',    items: 16, done: 0,                                       mode: 'pulse',  domain: 'discrete' },
  { name: 'Linear algebra primer', items: 14, done: 0,                                       mode: 'layers', domain: 'algebra' },
  { name: 'Number theory tricks',  items: 12, done: 0,                                       mode: 'pulse',  domain: 'discrete' },
];

const FILTERS = ['All', 'Mental', 'Adaptive', 'Saved'] as const;

export function Library({ onNavigate }: LibraryProps) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');

  return (
    <main className="responsive-pad" style={{ padding: '40px 36px', maxWidth: 1440, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 36, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <Kicker className="reveal reveal-1">LIBRARY · 144 LESSONS · 8 TRACKS</Kicker>
          <h1 className="reveal reveal-2" style={{ fontFamily: T.serif, fontSize: 'clamp(36px, 5vw, 64px)', lineHeight: 0.96, letterSpacing: '-0.03em', fontWeight: 400, margin: '12px 0 0' }}>
            Every shortcut, in your head.
          </h1>
        </div>
        <div className="reveal reveal-3" style={{ display: 'flex', gap: 8 }}>
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)} className="btn-press" style={chipBtn(filter === f)}>{f}</button>
          ))}
        </div>
      </div>

      <div className="stagger-children" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
        {TRACKS.map((t, i) => (
          <button
            key={i}
            onClick={() => onNavigate({ name: 'drill', mode: t.mode, domain: t.domain })}
            className="lift btn-press"
            style={{
              background: i === 0 ? T.ink : T.paper,
              color: i === 0 ? T.paper : T.ink,
              border: i === 0 ? 'none' : `1px solid ${T.hair}`,
              padding: 24,
              minHeight: 240,
              position: 'relative',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              textAlign: 'left',
              fontFamily: 'inherit',
              borderRadius: 0,
            }}
          >
            <div>
              {t.tag && <div style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: '0.2em', opacity: 0.7, color: t.accent }}>{t.tag}</div>}
              <div style={{ fontFamily: T.serif, fontSize: 28, lineHeight: 1.05, marginTop: 8 }}>{t.name}</div>
            </div>
            <div>
              <div style={{ height: 3, background: i === 0 ? '#ffffff20' : T.hair, position: 'relative', marginBottom: 8 }}>
                <div style={{ position: 'absolute', inset: 0, width: `${(t.done / t.items) * 100}%`, background: i === 0 ? T.accent : T.ink }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, opacity: 0.7, fontFamily: T.mono }}>
                <span>{t.done} / {t.items}</span>
                <span>{Math.round((t.done / t.items) * 100)}%</span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </main>
  );
}
