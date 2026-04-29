/**
 * 05 ARENA — head-to-head with the AI. Best of N rounds, the AI's "speed
 * bar" fills at a randomized rate; user has to lock in their answer first.
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

const TOTAL_ROUNDS = 15;
const RECENT_KEEP = 5;

interface LaneProps {
  color: string;
  label: string;
  v: number;
}
function Lane({ color, label, v }: LaneProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', color, width: 30, fontFamily: T.mono }}>{label}</span>
      <div style={{ flex: 1, height: 8, background: '#ffffff10', position: 'relative', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${v * 100}%`, background: color, boxShadow: `0 0 12px ${color}`, transition: 'width 100ms linear' }} />
      </div>
    </div>
  );
}

export function ArenaDrill({ domain, onExit, onComplete }: DrillProps) {
  const [you, setYou] = useState(0);
  const [ai, setAi] = useState(0);
  const [round, setRound] = useState(1);
  const [problem, setProblem] = useState<Problem>(() => genProblem(domain));
  const [input, setInput] = useState('');
  const [yourBar, setYourBar] = useState(0);
  const [aiBar, setAiBar] = useState(0);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const recentRef = useRef<string[]>([]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // AI's bar fills at a random pace each round; if it fills first, AI scores.
  useEffect(() => {
    if (done) return;
    setYourBar(0);
    setAiBar(0);
    const speed = 0.012 + Math.random() * 0.018;
    const id = window.setInterval(() => {
      setAiBar((b) => {
        const nb = b + speed;
        if (nb >= 1) {
          window.clearInterval(id);
          setAi((a) => a + 1);
          advanceRound(false);
          return 1;
        }
        return nb;
      });
    }, 100);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, done]);

  const advanceRound = (userScored: boolean) => {
    if (round >= TOTAL_ROUNDS) {
      setDone(true);
      onComplete({
        mode: 'Arena',
        solved: you + (userScored ? 1 : 0),
        youScore: you + (userScored ? 1 : 0),
        aiScore: ai + (userScored ? 0 : 1),
      });
      return;
    }
    setRound((r) => r + 1);
    const exclude = new Set(recentRef.current);
    recentRef.current = [...recentRef.current, problem.q].slice(-RECENT_KEEP);
    setProblem(genProblem(domain, exclude));
    setInput('');
  };

  const submit = () => {
    if (done) return;
    if (checkAnswer(input, problem.a)) {
      setYou((y) => y + 1);
      setYourBar(1);
      window.setTimeout(() => advanceRound(true), 200);
    } else {
      setInput('');
    }
  };

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      minHeight: 'calc(100vh - 60px)',
      background: '#08070d',
      color: '#fff',
      fontFamily: T.sans,
      display: 'grid',
      gridTemplateRows: 'auto auto 1fr auto',
      overflow: 'hidden',
    }}>
      <DrillBack onClick={onExit} />

      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `radial-gradient(circle at 25% 50%, ${T.accentYou}25, transparent 50%), radial-gradient(circle at 75% 50%, ${T.accentAi}25, transparent 50%)`,
      }} />

      <header className="arena-scoreboard" style={{ padding: '20px 32px 20px 80px', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 32, position: 'relative', borderBottom: '1px solid #ffffff10' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 52, height: 52, borderRadius: 26, background: `linear-gradient(135deg, ${T.accentYou}, ${T.accentYou}80)`, boxShadow: `0 0 32px ${T.accentYou}80` }} />
          <div>
            <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: '0.15em', textTransform: 'uppercase' }}>YOU · UNRANKED</div>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>you</div>
          </div>
        </div>
        <div className="arena-round" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.25em', opacity: 0.5, fontFamily: T.mono }}>ROUND</div>
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1, fontFamily: T.slab }}>{String(round).padStart(2, '0')}<span style={{ opacity: 0.4 }}>/{TOTAL_ROUNDS}</span></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'flex-end' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: '0.15em', textTransform: 'uppercase' }}>OPP · CALIBRATING</div>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>HAIKU.7</div>
          </div>
          <div style={{ width: 52, height: 52, borderRadius: 26, background: `linear-gradient(135deg, ${T.accentAi}, ${T.accentAi}80)`, display: 'grid', placeItems: 'center', fontSize: 22, fontWeight: 700, color: '#08070d', boxShadow: `0 0 32px ${T.accentAi}80` }}>◐</div>
        </div>
      </header>

      <div style={{ padding: '24px 32px 0', position: 'relative', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 32 }}>
        <div style={{ fontSize: 'clamp(56px, 8vw, 92px)', fontWeight: 700, letterSpacing: '-0.04em', color: T.accentYou, textShadow: `0 0 40px ${T.accentYou}60`, lineHeight: 1, fontFamily: T.slab }}>{String(you).padStart(2, '0')}</div>
        <div style={{ fontSize: 24, opacity: 0.4, fontWeight: 300 }}>vs</div>
        <div style={{ fontSize: 'clamp(56px, 8vw, 92px)', fontWeight: 700, letterSpacing: '-0.04em', color: T.accentAi, textShadow: `0 0 40px ${T.accentAi}60`, lineHeight: 1, textAlign: 'right', fontFamily: T.slab }}>{String(ai).padStart(2, '0')}</div>
      </div>

      <main style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <Kicker style={{ letterSpacing: '0.3em', marginBottom: 16, color: 'rgba(255,255,255,0.5)' }}>SOLVE FIRST · 2 PT</Kicker>
        <div className="fade-in" key={round} style={{
          fontSize: 'clamp(96px, 14vw, 192px)',
          lineHeight: 0.95,
          letterSpacing: '-0.04em',
          fontWeight: 600,
          fontFamily: T.slab,
          background: 'linear-gradient(180deg, #fff, #ffffff80)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          marginBottom: 28,
          textAlign: 'center',
        }}>{problem.q}</div>

        <div style={{ width: '100%', maxWidth: 720, display: 'grid', gap: 14, marginBottom: 28 }}>
          <Lane color={T.accentYou} label="YOU" v={yourBar} />
          <Lane color={T.accentAi} label="AI" v={aiBar} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <MathToolbar inputRef={inputRef} value={input} onChange={setInput} variant="dark" />
          <div className="answer-ring" style={{ display: 'flex', border: `2px solid ${T.accentYou}`, background: `${T.accentYou}10`, boxShadow: `0 0 32px ${T.accentYou}40` }}>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              placeholder={done ? 'match over' : 'lock in answer'}
              disabled={done}
              style={{ background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontFamily: T.sans, fontSize: 28, padding: '14px 24px', flex: 1, minWidth: 200, textAlign: 'center' }}
            />
            <button onClick={submit} disabled={done} className="btn-press" style={{ border: 'none', background: T.accentYou, color: '#08070d', padding: '0 28px', fontSize: 13, fontWeight: 700, letterSpacing: '0.15em', cursor: done ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
              {done ? 'END' : 'FIRE ↵'}
            </button>
          </div>
        </div>
      </main>

      <footer style={{ padding: '14px 32px', borderTop: '1px solid #ffffff10', display: 'flex', justifyContent: 'space-between', fontSize: 11, opacity: 0.5, fontFamily: T.mono, letterSpacing: '0.15em', gap: 12, flexWrap: 'wrap' }}>
        <span>BEST OF {TOTAL_ROUNDS} · MENTAL ONLY · NO CALC</span>
        <span style={{ color: T.accentYou }}>● {done ? (you > ai ? 'YOU WIN' : you < ai ? 'AI WINS' : 'TIE') : 'LIVE'}</span>
      </footer>
    </div>
  );
}
