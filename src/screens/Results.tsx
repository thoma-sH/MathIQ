import { T } from '../design/tokens';
import { Kicker } from '../design/Kicker';
import type { Route } from '../router';
import type { DrillResult } from '../drills/types';

interface ResultsProps {
  result: DrillResult | null;
  onNavigate: (route: Route) => void;
}

interface StatProps {
  l: string;
  v: string;
  sub: string;
  border?: boolean;
}

function Stat({ l, v, sub, border }: StatProps) {
  return (
    <div style={{ padding: '20px 24px', borderLeft: border ? `1px solid ${T.hair}` : 'none' }}>
      <Kicker>{l}</Kicker>
      <div style={{ fontFamily: T.serif, fontSize: 56, lineHeight: 1, letterSpacing: '-0.03em', marginTop: 6 }}>{v}</div>
      <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>{sub}</div>
    </div>
  );
}

interface Stumble {
  q: string;
  y: string;
  a: string | number;
  why: string;
}

/**
 * Drills don't yet feed missed problems into the result; until they do
 * this section shows an empty state. Wire results.stumbles through from
 * the drill loops to populate.
 */
const STUMBLED: Stumble[] = [];

export function Results({ result, onNavigate }: ResultsProps) {
  return (
    <main className="responsive-pad" style={{
      padding: '48px 56px',
      display: 'grid',
      gridTemplateRows: 'auto auto 1fr auto',
      gap: 32,
      maxWidth: 1440,
      margin: '0 auto',
      minHeight: 'calc(100vh - 60px)',
    }}>
      <div>
        <Kicker className="reveal reveal-1">{result?.mode ?? 'Drill'} · {result?.durationSec ?? 0}s</Kicker>
        <h1 className="reveal reveal-2" style={{ fontFamily: T.serif, fontSize: 'clamp(48px, 7vw, 84px)', lineHeight: 0.95, letterSpacing: '-0.03em', fontWeight: 400, margin: '12px 0 0' }}>
          Faster. Sharper. <span style={{ color: T.accent }}>+{Math.max(1, result?.solved ?? 0)} IQ</span>
        </h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderTop: `1px solid ${T.ink}`, borderBottom: `1px solid ${T.ink}` }}>
        <Stat l="Solved" v={String(result?.solved ?? 0)} sub="this session" />
        <Stat l="Streak" v={String(result?.streak ?? 0)} sub="best run" border />
        <Stat l="Mode"   v={result?.mode ?? '—'}        sub="drill type" border />
        <Stat l="Time"   v={`${result?.durationSec ?? 0}s`} sub="elapsed" border />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 36 }}>
        <div>
          <Kicker style={{ marginBottom: 14 }}>WHERE YOU STUMBLED</Kicker>
          {STUMBLED.length === 0 ? (
            <div style={{ borderTop: `1px dashed ${T.hair}`, padding: '24px 0', fontSize: 13, opacity: 0.55 }}>
              No misses recorded — perfect run, or first session. Iris will start flagging patterns once you have a few drills under your belt.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {STUMBLED.map((r, i) => (
                <div key={i} style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto auto auto 1fr auto',
                  gap: 18,
                  padding: '14px 0',
                  borderTop: `1px dashed ${T.hair}`,
                  alignItems: 'baseline',
                }}>
                  <span style={{ fontFamily: T.serif, fontSize: 28 }}>{r.q}</span>
                  <span style={{ fontFamily: T.mono, fontSize: 14, color: T.accent, textDecoration: 'line-through' }}>{r.y}</span>
                  <span style={{ fontFamily: T.mono, fontSize: 14 }}>→ {r.a}</span>
                  <span style={{ fontSize: 13, opacity: 0.7 }}>{r.why}</span>
                  <button onClick={() => onNavigate({ name: 'tutor' })} style={{ background: 'transparent', border: `1px solid ${T.ink}`, padding: '6px 10px', fontSize: 11, fontFamily: T.mono, cursor: 'pointer' }}>
                    Iris explain
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <Kicker style={{ marginBottom: 14 }}>SPEED CURVE</Kicker>
          <svg viewBox="0 0 320 120" style={{ width: '100%', height: 120 }}>
            <line x1="0" y1="60" x2="320" y2="60" stroke={T.hair} strokeDasharray="2 4" />
            <text x="160" y="65" fontSize="10" fontFamily={T.mono} fill={T.muted} textAnchor="middle">
              speed curve appears once you've completed multiple sessions
            </text>
          </svg>

          <Kicker style={{ marginTop: 24, marginBottom: 14 }}>NEW BADGES</Kicker>
          <div style={{ fontSize: 13, opacity: 0.55 }}>None yet — keep going.</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <button onClick={() => onNavigate({ name: 'tutor' })} style={{ background: 'transparent', color: T.ink, border: `1px solid ${T.ink}`, padding: '14px 22px', fontSize: 14, cursor: 'pointer' }}>
          Review wrong answers
        </button>
        <button onClick={() => onNavigate({ name: 'home' })} style={{ background: T.ink, color: T.paper, border: 'none', padding: '14px 26px', fontSize: 14, cursor: 'pointer' }}>
          Back to today →
        </button>
      </div>
    </main>
  );
}
