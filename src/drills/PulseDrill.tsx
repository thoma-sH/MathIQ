/**
 * 01 PULSE — newspaper front-page drill. The Daily Edition.
 *
 * Decluttered: keep the masthead + tempo table + lead article + session
 * stats. Forecast / Yesterday / Op-Iris quote / filed-by caption /
 * volume number / weather were prototype flavor — not load-bearing —
 * and made the page feel busy.
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
const TEMPOS = [60, 72, 96, 120] as const;
const RECENT_KEEP = 5;

export function PulseDrill({ domain, onExit, onComplete, drillTimer }: DrillProps) {
  const [bpm, setBpm] = useState(72);
  const [tick, setTick] = useState(0);
  const [problem, setProblem] = useState<Problem>(() => genProblem(domain));
  const [answer, setAnswer] = useState('');
  const [streak, setStreak] = useState(0);
  const [solved, setSolved] = useState(0);
  const [running, setRunning] = useState(true);
  const [timeLeft, setTimeLeft] = useState(drillTimer);
  const inputRef = useRef<HTMLInputElement>(null);
  const recentRef = useRef<string[]>([]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000 / bpm);
    return () => window.clearInterval(id);
  }, [bpm, running]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTimeLeft((t) => Math.max(0, t - 1)), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (timeLeft === 0 && running) {
      setRunning(false);
      onComplete({ mode: 'Pulse', solved, streak, durationSec: drillTimer });
    }
  }, [timeLeft, running, solved, streak, drillTimer, onComplete]);

  const advance = () => {
    const exclude = new Set(recentRef.current);
    const next = genProblem(domain, exclude);
    recentRef.current = [...recentRef.current, problem.q].slice(-RECENT_KEEP);
    setProblem(next);
    setAnswer('');
    setTick(0);
  };

  const submit = () => {
    if (checkAnswer(answer, problem.a)) {
      setStreak((s) => s + 1);
      setSolved((s) => s + 1);
    } else {
      setStreak(0);
    }
    advance();
  };

  const beat = tick % 4;

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        minHeight: 'calc(100vh - 60px)',
        background: T.paper,
        color: T.ink,
        fontFamily: T.sans,
        display: 'grid',
        gridTemplateRows: 'auto auto 1fr auto',
        overflow: 'hidden',
      }}
    >
      <DrillBack onClick={onExit} />

      <div
        style={{
          padding: '14px 32px 10px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'baseline',
          borderBottom: `2px solid ${T.ink}`,
        }}
      >
        <div style={{ fontFamily: T.serif, fontSize: 'clamp(28px, 4vw, 36px)', lineHeight: 1, letterSpacing: '-0.01em' }}>
          The MathIQ Daily
        </div>
      </div>

      <div
        style={{
          padding: '6px 32px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: `1px solid ${T.ink}`,
          fontFamily: T.mono,
          fontSize: 10,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontWeight: 700 }}>Pulse · {domain}</span>
        <div style={{ display: 'flex', gap: 18 }}>
          <span>Solved · <b style={{ fontFamily: T.slab }}>{String(solved).padStart(3, '0')}</b></span>
          <span>Streak · <b style={{ fontFamily: T.slab }}>{String(streak).padStart(2, '0')}</b></span>
          <span>Time · <b style={{ fontFamily: T.slab, color: timeLeft < 10 ? T.accent : T.ink }}>{timeLeft}s</b></span>
        </div>
      </div>

      <main
        className="grid-pulse"
        style={{
          display: 'grid',
          gridTemplateColumns: '180px 1px minmax(0,1fr) 1px 220px',
          gap: 24,
          padding: '24px 32px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <aside className="pulse-aside-l">
          <Kicker style={{ marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${T.ink}` }}>Tempo</Kicker>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                padding: '8px 0',
                borderBottom: `1px dotted ${HAIR}`,
                opacity: beat === i ? 1 : 0.5,
                transition: 'opacity 240ms var(--ease-out-expo)',
              }}
            >
              <span style={{
                fontFamily: T.slab,
                fontSize: 16,
                fontWeight: beat === i ? 700 : 400,
                color: beat === i ? T.accent : T.ink,
              }}>{['I', 'II', 'III', 'IV'][i]}</span>
              <span style={{ fontFamily: T.mono, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                {['set', 'breathe', 'compute', 'answer'][i]}
              </span>
            </div>
          ))}
        </aside>

        <div className="rule" style={{ background: T.ink, opacity: 0.9 }} />

        <article className="pulse-lead" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Kicker color={T.accent} style={{ letterSpacing: '0.25em', marginBottom: 8, fontWeight: 600, textAlign: 'center' }}>
            ◆ The Lead · {problem.kicker} ◆
          </Kicker>

          <div style={{ display: 'grid', placeItems: 'center', flex: 1, position: 'relative', minHeight: 220 }}>
            <div
              style={{
                position: 'absolute',
                width: 360,
                height: 360,
                border: `1px solid ${T.accent}`,
                borderRadius: '50%',
                opacity: beat === 0 ? 0.18 : 0,
                transform: `scale(${beat === 0 ? 1 : 0.6})`,
                transition: 'opacity 600ms, transform 600ms cubic-bezier(0.2, 0.7, 0.3, 1)',
                pointerEvents: 'none',
              }}
            />
            <div
              className="fade-in"
              key={problem.q}
              style={{
                fontFamily: T.slab,
                fontSize: 'clamp(56px, 12vw, 144px)',
                lineHeight: 0.92,
                letterSpacing: '-0.04em',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                position: 'relative',
                textAlign: 'center',
              }}
            >
              {problem.q}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 8 }}>
            <MathToolbar
              inputRef={inputRef}
              value={answer}
              onChange={setAnswer}
              variant="editorial"
              style={{ width: 320, maxWidth: '100%' }}
            />
            <div className="answer-ring" style={{ display: 'flex', border: `1.5px solid ${T.ink}`, background: '#fff', width: 320, maxWidth: '100%' }}>
              <input
                ref={inputRef}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                placeholder="your answer"
                style={{
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  padding: '12px 18px',
                  fontSize: 22,
                  flex: 1,
                  minWidth: 0,
                  fontFamily: T.slab,
                  fontWeight: 500,
                  textAlign: 'center',
                }}
              />
              <button onClick={submit} className="btn-press" style={{
                border: 'none',
                borderLeft: `1.5px solid ${T.ink}`,
                background: T.ink,
                color: T.paper,
                padding: '0 22px',
                cursor: 'pointer',
                fontFamily: T.mono,
                fontSize: 10,
                letterSpacing: '0.18em',
                whiteSpace: 'nowrap',
              }}>SUBMIT ↵</button>
            </div>
          </div>
        </article>

        <div className="rule" style={{ background: T.ink, opacity: 0.9 }} />

        <aside className="pulse-aside-r">
          <Kicker style={{ marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${T.ink}` }}>This Session</Kicker>
          {[
            ['Solved', String(solved), 'this session'],
            ['Accuracy', solved > 0 ? `${Math.round((streak / Math.max(solved, 1)) * 100)}%` : '—', 'session'],
            ['Best run', String(streak), 'in a row'],
          ].map(([l, v, sub], i) => (
            <div key={i} style={{ padding: '10px 0', borderBottom: `1px dotted ${HAIR}` }}>
              <Kicker style={{ letterSpacing: '0.12em' }}>{l}</Kicker>
              <div style={{ fontFamily: T.slab, fontSize: 32, lineHeight: 1, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 2 }}>{v}</div>
              <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2 }}>{sub}</div>
            </div>
          ))}
        </aside>
      </main>

      <footer style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 32px',
        borderTop: `2px solid ${T.ink}`,
        fontFamily: T.mono,
        fontSize: 10,
        letterSpacing: '0.15em',
        textTransform: 'uppercase',
        gap: 12,
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ opacity: 0.55, marginRight: 8 }}>Tempo</span>
          {TEMPOS.map((v) => (
            <button key={v} onClick={() => setBpm(v)} className="btn-press" style={{
              padding: '4px 10px',
              border: `1px solid ${T.ink}`,
              background: bpm === v ? T.ink : 'transparent',
              color: bpm === v ? T.paper : T.ink,
              fontFamily: T.slab,
              fontSize: 11,
              letterSpacing: '0.04em',
              cursor: 'pointer',
              transition: 'background 200ms, color 200ms',
            }}>{v}</button>
          ))}
        </div>
        <div className="footer-collapse" style={{ opacity: 0.55 }}>
          ↵ submit · Esc exit
        </div>
      </footer>
    </div>
  );
}
