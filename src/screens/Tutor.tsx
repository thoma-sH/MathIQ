import { useEffect, useRef, useState, type ReactNode } from 'react';
import { T } from '../design/tokens';
import { Kicker } from '../design/Kicker';
import { MathToolbar } from '../design/MathToolbar';
import { useTweaks } from '../state/tweaks';
import { findExpression, tipForExpression } from '../math/evalExpression';
import type { AiTone } from '../state/tweaks';

interface Turn {
  who: 'iris' | 'you';
  text?: string;
  node?: ReactNode;
}

const WELCOME: Turn = {
  who: 'iris',
  text: "Hi — I'm Iris. Paste a math expression (\"47 × 8\", \"15% of 240\"), or just say what you want to practice.",
};

function Bubble({ who, text, children }: { who: 'iris' | 'you'; text?: string; children?: ReactNode }) {
  const isIris = who === 'iris';
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <div style={{
        width: 32,
        height: 32,
        borderRadius: 16,
        flexShrink: 0,
        background: isIris ? T.accent : T.ink,
        color: isIris ? T.ink : T.paper,
        display: 'grid',
        placeItems: 'center',
        fontSize: 12,
        fontWeight: 600,
      }}>
        {isIris ? '◐' : '·'}
      </div>
      <div style={{ flex: 1, paddingTop: 4, minWidth: 0 }}>
        <Kicker style={{ marginBottom: 6, letterSpacing: '0.15em' }}>{isIris ? 'IRIS' : 'YOU'}</Kicker>
        <div style={{ fontSize: 15, lineHeight: 1.55, maxWidth: 600 }}>{children ?? text}</div>
      </div>
    </div>
  );
}

/**
 * Build Iris's reply from the user message. Tries (in order):
 *   1. percent-of pattern → solves it
 *   2. an embedded math expression → evaluates and offers a tip
 *   3. otherwise — a tone-flavored prompt to give it a real expression
 */
function irisReply(userMsg: string, tone: AiTone): { text: string; concepts: string[]; pad: string[] } {
  const trimmed = userMsg.trim();

  const pct = trimmed.match(/(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)/i);
  if (pct) {
    const p = Number(pct[1]);
    const n = Number(pct[2]);
    const v = (p / 100) * n;
    return {
      text:
        tone === 'silent'  ? `${v}` :
        tone === 'direct'  ? `${p}% of ${n} = ${v}.` :
        tone === 'witty'   ? `${p}% of ${n} = ${v}. Halve, then halve, then halve — that's the percent two-step.` :
                              `${p}% of ${n} is ${v}. Tip: 10% of ${n} = ${n / 10}; scale up.`,
      concepts: ['percent', 'mental scaling'],
      pad: [`${p}% of ${n}`, `= ${p}/100 · ${n}`, `= ${v}`],
    };
  }

  const found = findExpression(trimmed);
  if (found) {
    const { expr, value } = found;
    const tip = tipForExpression(expr);
    return {
      text:
        tone === 'silent'  ? `${value}` :
        tone === 'direct'  ? `${expr} = ${value}.${tip ? ' ' + tip : ''}` :
        tone === 'witty'   ? `${expr} = ${value}. Numbers, mildly intimidated.${tip ? ' ' + tip : ''}` :
                              `${expr} = ${value}.${tip ? ' ' + tip : ' Nice — try a harder one.'}`,
      concepts: ['arithmetic'],
      pad: [expr, `= ${value}`],
    };
  }

  if (/help|how|teach|explain/i.test(trimmed)) {
    return {
      text: 'I can: solve mental-math expressions you paste, suggest shortcuts, and pull up a related drill. Try giving me an expression like "23 × 17" or "15% of 240".',
      concepts: [],
      pad: [],
    };
  }

  return {
    text: 'Got it. Paste an expression (e.g. "47 × 8", "log_2 64", "20% of 350") and I\'ll solve it with a mental shortcut.',
    concepts: [],
    pad: [],
  };
}

export function Tutor() {
  const { tweaks } = useTweaks();
  const [thread, setThread] = useState<Turn[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [pad, setPad] = useState<string[]>([]);
  const [concepts, setConcepts] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scroll the thread to the bottom on each new turn.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread]);

  const send = () => {
    const msg = input.trim();
    if (!msg) return;
    const reply = irisReply(msg, tweaks.aiTone);
    setThread((t) => [
      ...t,
      { who: 'you', text: msg },
      { who: 'iris', text: reply.text },
    ]);
    setPad(reply.pad);
    setConcepts((c) => Array.from(new Set([...c, ...reply.concepts])));
    setInput('');
  };

  return (
    <main
      className="grid-tutor"
      style={{
        display: 'grid',
        gridTemplateColumns: '260px minmax(0,1fr) 320px',
        height: 'calc(100vh - 60px)',
        overflow: 'hidden',
      }}
    >
      <aside className="tutor-side" style={{ borderRight: `1px solid ${T.hair}`, padding: '28px 20px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontFamily: T.serif, fontSize: 22, marginBottom: 18 }}>Iris</div>
        <button
          onClick={() => { setThread([WELCOME]); setPad([]); setConcepts([]); }}
          className="btn-press"
          style={{
            background: T.ink,
            color: T.paper,
            border: 'none',
            padding: '10px',
            fontSize: 13,
            marginBottom: 18,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          + New session
        </button>
        <Kicker style={{ marginTop: 10, marginBottom: 6 }}>RECENT</Kicker>
        <div style={{ padding: '8px 10px', fontSize: 13, opacity: 0.55 }}>
          Past conversations will show up here.
        </div>
      </aside>

      <section style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto', minWidth: 0 }}>
        <header style={{ padding: '20px 36px', borderBottom: `1px solid ${T.hair}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontFamily: T.serif, fontSize: 22 }}>New conversation</div>
            <div style={{ fontSize: 12, opacity: 0.6 }}>Iris is in <b>{tweaks.aiTone}</b> mode</div>
          </div>
          <div style={{ fontFamily: T.mono, fontSize: 11, opacity: 0.6 }}>
            {thread.length} turn{thread.length === 1 ? '' : 's'}
          </div>
        </header>

        <div ref={scrollRef} className="no-scrollbar" style={{ overflowY: 'auto', padding: '28px 36px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          {thread.map((t, i) => <Bubble key={i} who={t.who} text={t.text}>{t.node}</Bubble>)}
        </div>

        <footer style={{
          borderTop: `1px solid ${T.hair}`,
          padding: '12px 20px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}>
          <MathToolbar inputRef={inputRef} value={input} onChange={setInput} variant="editorial" />
          <div className="answer-ring" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
              placeholder='Ask Iris — try "47 × 8" or "√144 + 18"'
              style={{ flex: 1, minWidth: 200, border: `1px solid ${T.hair}`, padding: '12px 16px', fontSize: 14, outline: 'none', background: T.paper }}
            />
            <button onClick={send} className="btn-press lift" style={{
              background: T.ink,
              color: T.paper,
              border: 'none',
              padding: '12px 20px',
              fontSize: 14,
              cursor: 'pointer',
            }}>
              Send <span className="arrow-nudge">↵</span>
            </button>
          </div>
        </footer>
      </section>

      <aside className="tutor-rail" style={{ borderLeft: `1px solid ${T.hair}`, padding: '28px 24px', background: T.paper2 }}>
        <Kicker style={{ marginBottom: 14 }}>WORKING PAD</Kicker>
        {pad.length > 0 ? (
          <div style={{ fontFamily: T.serif, fontSize: 18, lineHeight: 1.6 }}>
            {pad.map((line, i) => (
              <div key={i} style={{ opacity: i === pad.length - 1 ? 1 : 0.7 }}>{line}</div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, opacity: 0.55, lineHeight: 1.5 }}>
            Iris will sketch the steps here as you work through a problem.
          </div>
        )}

        <Kicker style={{ marginTop: 32, marginBottom: 12 }}>CONCEPTS TOUCHED</Kicker>
        {concepts.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {concepts.map((c) => (
              <span key={c} style={{
                padding: '4px 10px',
                border: `1px solid ${T.ink}40`,
                fontSize: 11,
                fontFamily: T.mono,
              }}>{c}</span>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, opacity: 0.55 }}>None yet.</div>
        )}
      </aside>
    </main>
  );
}
