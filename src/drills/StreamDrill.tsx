/**
 * 02 STREAM — almanac ledger feed. Problems flow past on a timer; a
 * combo multiplier rewards staying in the pocket.
 *
 * Decluttered: single-line masthead (volume / weather gone), tightened
 * scoreboard row, italic flavor caption removed, recording counter
 * dropped from the footer.
 */
import { useEffect, useRef, useState } from 'react';
import { T } from '../design/tokens';
import { Kicker } from '../design/Kicker';
import { DrillBack } from '../shell/DrillBack';
import { MathToolbar } from '../design/MathToolbar';
import { genProblem } from '../math/generators';
import { checkAnswer } from '../math/checkAnswer';
import type { Problem } from '../math/types';
import type { DrillProps } from './types';

const HAIR = 'rgba(22,17,10,0.18)';
const SESSION_SEC = 120;
const RECENT_KEEP = 5;

interface StreamItem extends Problem {
  id: number;
  age: number;
}

let nextId = 0;
const seed = (n: number, domain: Parameters<typeof genProblem>[0]): StreamItem[] => {
  const recent = new Set<string>();
  return Array.from({ length: n }, (_, i) => {
    const p = genProblem(domain, recent);
    recent.add(p.q);
    return { ...p, id: nextId++, age: i };
  });
};

export function StreamDrill({ domain, onExit, onComplete }: DrillProps) {
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [solved, setSolved] = useState(0);
  const [problems, setProblems] = useState<StreamItem[]>(() => seed(7, domain));
  const [input, setInput] = useState('');
  const [timeLeft, setTimeLeft] = useState(SESSION_SEC);
  const [running, setRunning] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setProblems((prev) => {
        const next = prev.map((p) => ({ ...p, age: p.age + 1 }));
        if (next.length > 0 && next[0]!.age > 18) next.shift();
        const recent = new Set(next.slice(-RECENT_KEEP).map((p) => p.q));
        const fresh = genProblem(domain, recent);
        next.push({ ...fresh, id: nextId++, age: 0 });
        return next.slice(-9);
      });
    }, 2200);
    return () => window.clearInterval(id);
  }, [running, domain]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTimeLeft((t) => Math.max(0, t - 1)), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (timeLeft === 0 && running) {
      setRunning(false);
      onComplete({ mode: 'Stream', solved, durationSec: SESSION_SEC });
    }
  }, [timeLeft, running, solved, onComplete]);

  const submit = () => {
    const target = problems[0];
    if (!target) return;
    if (checkAnswer(input, target.a)) {
      setScore((s) => s + 50 * Math.max(combo + 1, 1));
      setCombo((c) => c + 1);
      setSolved((s) => s + 1);
    } else {
      setCombo(0);
    }
    setInput('');
    setProblems((prev) => prev.slice(1));
  };

  const target: StreamItem = problems[0] ?? { id: -1, q: '—', a: 0, kicker: '—', topic: '—', age: 0 };

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      minHeight: 'calc(100vh - 60px)',
      background: T.paper,
      color: T.ink,
      fontFamily: T.sans,
      display: 'grid',
      gridTemplateRows: 'auto auto 1fr auto',
      overflow: 'hidden',
    }}>
      <DrillBack onClick={onExit} />

      <div style={{ padding: '14px 32px 8px', display: 'flex', justifyContent: 'center', alignItems: 'baseline', borderBottom: `2px solid ${T.ink}` }}>
        <div style={{ fontFamily: T.serif, fontSize: 'clamp(26px, 3.5vw, 32px)', textAlign: 'center', lineHeight: 1 }}>The Ledger</div>
      </div>

      <div style={{ padding: '6px 32px', display: 'flex', justifyContent: 'space-between', borderBottom: `1px solid ${T.ink}`, fontFamily: T.mono, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', gap: 12, flexWrap: 'wrap' }}>
        <span>
          <span style={{ fontFamily: T.slab, fontWeight: 600 }}>{score.toLocaleString()}</span>
          <span style={{ opacity: 0.55, marginLeft: 6 }}>pts</span>
          <span style={{ marginLeft: 16, color: T.accent, fontFamily: T.slab, fontWeight: 600 }}>×{combo}</span>
          <span style={{ opacity: 0.55, marginLeft: 6 }}>combo</span>
        </span>
        <span>
          <span>{solved}</span>
          <span style={{ opacity: 0.55, marginLeft: 6 }}>solved · </span>
          <span style={{ color: timeLeft < 15 ? T.accent : T.ink }}>{timeLeft}s</span>
          <span style={{ opacity: 0.55, marginLeft: 6 }}>left</span>
        </span>
      </div>

      <main className="grid-stream" style={{ display: 'grid', gridTemplateColumns: '280px minmax(0,1fr) 280px', position: 'relative' }}>
        <div className="stream-aside" style={{ borderRight: `1px solid ${T.ink}`, padding: '20px 24px', overflow: 'hidden' }}>
          <Kicker style={{ marginBottom: 10, paddingBottom: 6, borderBottom: `1px solid ${T.ink}` }}>Incoming ↓</Kicker>
          {problems.slice(1, 7).map((p, i) => (
            <div key={p.id} style={{ padding: '10px 0', borderBottom: `1px dotted ${HAIR}`, opacity: 1 - i * 0.13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: T.mono, fontSize: 9, letterSpacing: '0.12em', opacity: 0.6, textTransform: 'uppercase' }}>
                <span>{p.topic}</span>
                <span style={{ fontFamily: T.slab }}>+{Math.max(2, 20 - p.age * 1.5).toFixed(0)}pt</span>
              </div>
              <div style={{ fontFamily: T.slab, fontSize: 22, fontWeight: 500, marginTop: 2 }}>{p.q}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', placeItems: 'center', position: 'relative', padding: 32, minWidth: 0 }}>
          <div style={{ textAlign: 'center', maxWidth: '100%' }}>
            <Kicker style={{ letterSpacing: '0.25em', marginBottom: 14 }}>
              [ {target.topic} · expires in {Math.max(0, 18 - target.age)}s ]
            </Kicker>
            <div className="fade-in" key={target.id} style={{ fontFamily: T.slab, fontSize: 'clamp(64px, 11vw, 144px)', lineHeight: 0.95, letterSpacing: '-0.04em', fontWeight: 600 }}>
              {target.q}
            </div>
            <div style={{ marginTop: 24, display: 'inline-flex', flexDirection: 'column', alignItems: 'stretch' }}>
              <MathToolbar inputRef={inputRef} value={input} onChange={setInput} variant="editorial" />
              <div className="answer-ring" style={{ display: 'flex', alignItems: 'center', border: `1.5px solid ${T.ink}`, background: '#fff' }}>
                <span style={{ padding: '0 16px', color: T.accent, fontFamily: T.slab, fontSize: 22 }}>›</span>
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                  placeholder="solve"
                  style={{ background: 'transparent', border: 'none', outline: 'none', fontFamily: T.slab, fontSize: 24, fontWeight: 500, padding: '12px 0', flex: 1, minWidth: 140, textAlign: 'center', color: T.ink }}
                />
                <button onClick={submit} className="btn-press" style={{ padding: '12px 16px', background: T.ink, color: T.paper, fontFamily: T.mono, fontWeight: 600, fontSize: 11, letterSpacing: '0.18em', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>↵ FILE</button>
              </div>
            </div>
          </div>
        </div>

        <div className="stream-aside" style={{ borderLeft: `1px solid ${T.ink}`, padding: '20px 24px' }}>
          <Kicker style={{ marginBottom: 10, paddingBottom: 6, borderBottom: `1px solid ${T.ink}` }}>Tallies by domain</Kicker>
          {['Arithmetic', 'Algebra', 'Calculus', 'Trigonometry', 'Statistics', 'Discrete'].map((l) => (
            <div key={l} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                <span>{l}</span>
                <span style={{ fontFamily: T.slab, opacity: 0.5 }}>—</span>
              </div>
              <div style={{ height: 4, background: HAIR, position: 'relative' }} />
            </div>
          ))}
        </div>
      </main>

      <footer style={{ padding: '8px 32px', borderTop: `2px solid ${T.ink}`, display: 'flex', justifyContent: 'space-between', fontFamily: T.mono, fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', opacity: 0.7, gap: 12, flexWrap: 'wrap' }}>
        <span>↵ file · Esc pause</span>
        <span style={{ color: T.accent }}>● live</span>
      </footer>
    </div>
  );
}
