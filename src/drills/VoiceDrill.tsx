/**
 * 03 VOICE — hands-free with Iris.
 *
 * Iris actually speaks now (Web Speech API speechSynthesis): she reads
 * each problem out loud, reads her tone-flavored reply after each
 * answer, and the on-screen "phase" indicator + waveform are driven by
 * real TTS state instead of a cosmetic timer.
 *
 * Speech recognition (mic button) is wired through useSpeechRecognition
 * — the user's transcript drops straight into the answer field and they
 * can type or speak interchangeably. Both gracefully fall back when the
 * browser lacks support.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { T } from '../design/tokens';
import { Kicker } from '../design/Kicker';
import { DrillBack } from '../shell/DrillBack';
import { MathToolbar } from '../design/MathToolbar';
import { genProblem } from '../math/generators';
import { checkAnswer } from '../math/checkAnswer';
import { useSpeech, pickDefaultVoice } from '../voice/useSpeech';
import { useSpeechRecognition } from '../voice/useSpeechRecognition';
import { speakable } from '../voice/speakable';
import { parseAnswer } from '../voice/parseAnswer';
import type { Problem } from '../math/types';
import type { DrillProps } from './types';
import type { AiTone } from '../state/tweaks';

type Phase = 'speaking' | 'listening' | 'thinking';
type TurnKind = 'problem' | 'answer' | 'wrong';
interface Turn {
  who: 'AI' | 'YOU';
  text: string;
  kind: TurnKind;
}

const ACCENT_SAGE = '#7c9c7e';
const VOICE_BG = '#eef0e8';
const RECENT_KEEP = 5;

const TONE_LINE: Record<AiTone, (correct: boolean, expected: number | string) => string> = {
  encouraging: (c, a) => (c ? "Beautiful — keep that pace." : `Almost — answer was ${a}.`),
  direct:      (c, a) => (c ? "Correct."                    : `Wrong. ${a}.`),
  witty:       (c, a) => (c ? "Numbers tremble."            : `Off by some. The right one was ${a}.`),
  silent:      (_, a) => `${a}`,
};

const READ_NEXT = (q: string, kicker: string) =>
  `Next: ${kicker}. ${speakable(q)}.`;

interface VoiceDrillProps extends DrillProps {
  aiTone?: AiTone;
}

export function VoiceDrill({ domain, onExit, onComplete, aiTone = 'encouraging' }: VoiceDrillProps) {
  const [problem, setProblem] = useState<Problem>(() => genProblem(domain));
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [solved, setSolved] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [tick, setTick] = useState(0);
  const [muted, setMuted] = useState(false);
  const [phase, setPhase] = useState<Phase>('speaking');
  const inputRef = useRef<HTMLInputElement>(null);
  const recentRef = useRef<string[]>([]);

  const { speak, cancel, speaking, voices, supported: ttsSupported } = useSpeech();
  const voice = useMemo(() => pickDefaultVoice(voices), [voices]);

  // Run the spoken transcript through parseAnswer so "forty seven"
  // becomes "47" and "two squared" becomes "2²" before the answer
  // checker compares it against the expected value. The user still
  // sees the raw transcript in the field for transparency.
  const handleFinal = useCallback((text: string) => {
    const parsed = parseAnswer(text);
    setInput(parsed.candidate || text);
    window.setTimeout(() => submitWithRef.current(parsed.candidate || text), 120);
  }, []);
  const submitWithRef = useRef<(t: string) => void>(() => {});
  const sr = useSpeechRecognition({ onFinal: handleFinal });

  // Drive the on-screen phase indicator off real TTS state.
  useEffect(() => {
    if (speaking) setPhase('speaking');
    else if (phase === 'speaking') setPhase('listening');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speaking]);

  // Waveform tick + elapsed clock.
  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 80);
    const e = window.setInterval(() => setElapsed((x) => x + 1), 1000);
    return () => { window.clearInterval(t); window.clearInterval(e); };
  }, []);

  // Speak the first problem on mount. We rely on the user's click on
  // the drill picker / dashboard tile counting as the gesture that
  // unlocks autoplay. If a browser still blocks, the "Repeat" button
  // re-triggers from a fresh user click.
  useEffect(() => {
    if (muted || aiTone === 'silent') return;
    speak(READ_NEXT(problem.q, problem.kicker), { voice });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const advance = () => {
    const exclude = new Set(recentRef.current);
    const next = genProblem(domain, exclude);
    recentRef.current = [...recentRef.current, problem.q].slice(-RECENT_KEEP);
    setProblem(next);
    setInput('');
    setPhase('speaking');
    if (!muted && aiTone !== 'silent') {
      speak(READ_NEXT(next.q, next.kicker), { voice });
    }
  };

  const submitWith = (rawAnswer: string) => {
    const correct = checkAnswer(rawAnswer, problem.a);
    if (correct) setSolved((s) => s + 1);

    const userTurn: Turn = { who: 'YOU', text: rawAnswer || '(empty)', kind: correct ? 'answer' : 'wrong' };
    const replyText = TONE_LINE[aiTone](correct, problem.a);
    const aiTurn:   Turn = { who: 'AI',  text: replyText, kind: 'problem' };
    setTranscript((t) => [...t, userTurn, aiTurn].slice(-8));

    setPhase('thinking');

    // Speak the reply, then advance + speak the next problem when the
    // reply utterance ends. Falls through immediately if muted/silent.
    if (muted || aiTone === 'silent' || !ttsSupported) {
      window.setTimeout(advance, 220);
    } else {
      speak(replyText, { voice, onEnd: advance });
    }
  };

  // Keep a ref to the latest submitWith so SR's `onFinal` callback (which
  // captures handleFinal from the render where SR was started) can always
  // call the freshest version with current state.
  submitWithRef.current = submitWith;

  const submit = () => submitWith(input);

  const repeat = () => {
    if (muted) return;
    speak(READ_NEXT(problem.q, problem.kicker), { voice });
  };

  const toggleMute = () => {
    setMuted((m) => {
      const next = !m;
      if (next) cancel();
      return next;
    });
  };

  // Cancel any in-flight TTS before opening the mic so Iris's voice
  // doesn't bleed into the user's recognition.
  const startMic = useCallback(() => {
    if (!sr.supported || sr.listening) return;
    cancel();
    sr.start();
  }, [sr, cancel]);

  const toggleMic = () => {
    if (sr.listening) sr.stop();
    else startMic();
  };

  // Hands-free: when Iris finishes speaking, automatically open the mic
  // for the user's response. Skip if muted or browser doesn't support
  // SR. 500 ms gives the TTS audio buffer time to fully flush so SR
  // doesn't pick up the tail of Iris's speech.
  useEffect(() => {
    if (phase !== 'listening') return;
    if (muted || !sr.supported) return;
    if (sr.listening) return;
    const id = window.setTimeout(() => startMic(), 500);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, muted]);

  // Waveform bars synthesised off the current phase + tick.
  const bars = Array.from({ length: 64 }, (_, i) => {
    const offset = i * 0.4;
    const base = phase === 'speaking' ? 0.5 : phase === 'listening' ? 0.3 : 0.15;
    const amp = phase === 'thinking' ? 0.05 : 0.45;
    return base + Math.abs(Math.sin(tick * 0.15 + offset)) * amp;
  });

  const phaseLabel =
    phase === 'speaking'  ? 'Iris is speaking'
    : phase === 'thinking' ? 'thinking…'
    : sr.listening         ? '● listening — speak now'
    : sr.supported         ? 'your turn — speak or type'
    :                        'your turn — type your answer';

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      minHeight: 'calc(100vh - 60px)',
      background: VOICE_BG,
      color: '#1f2a1f',
      fontFamily: T.sans,
      display: 'grid',
      gridTemplateRows: 'auto 1fr auto',
    }}>
      <DrillBack onClick={onExit} />

      <header style={{ padding: '24px 36px 24px 80px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 8, height: 8, borderRadius: 4, background: ACCENT_SAGE,
            boxShadow: `0 0 0 ${4 + Math.sin(tick * 0.15) * 4}px ${ACCENT_SAGE}30`,
          }} />
          <span style={{ fontSize: 14, fontWeight: 500, letterSpacing: '-0.01em' }}>Iris · {aiTone}</span>
          {!ttsSupported && (
            <span style={{ fontSize: 11, opacity: 0.55, fontFamily: T.mono, marginLeft: 4 }}>
              (no TTS in this browser)
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, opacity: 0.6, fontFamily: T.mono, letterSpacing: '0.1em' }}>
          {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')} · {solved} solved
        </div>
      </header>

      {!sr.supported && (
        <div role="status" style={{
          padding: '10px 36px 10px 80px',
          background: '#fff3cd',
          color: '#5a4500',
          fontSize: 12,
          fontFamily: T.mono,
          letterSpacing: '0.08em',
          borderBottom: '1px solid #00000010',
        }}>
          Voice answers need Chrome, Edge, or Safari. You can still type your answers below.
        </div>
      )}

      <main className="grid-voice" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 380px', gap: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 32, padding: 40 }}>
          <div style={{ textAlign: 'center', maxWidth: 560 }}>
            <Kicker style={{ marginBottom: 18 }}>{phaseLabel}</Kicker>
            <div style={{ fontSize: 'clamp(36px, 5vw, 56px)', lineHeight: 1.1, letterSpacing: '-0.03em', fontFamily: T.serif }}>
              <span style={{ opacity: 0.4 }}>"</span>{problem.q}<span style={{ opacity: 0.4 }}>"</span>
            </div>
            <div style={{ fontSize: 13, opacity: 0.5, marginTop: 12 }}>{problem.kicker}</div>
          </div>

          <div style={{ display: 'flex', gap: 4, alignItems: 'center', height: 100 }}>
            {bars.map((h, i) => (
              <div key={i} style={{ width: 4, height: `${h * 100}%`, background: ACCENT_SAGE, borderRadius: 2, opacity: 0.4 + h * 0.6, transition: 'height 80ms linear' }} />
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <MathToolbar
              inputRef={inputRef}
              value={input}
              onChange={setInput}
              variant="soft"
              style={{ borderRadius: 16, border: '1px solid #1f2a1f20' }}
            />
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
              <div className="answer-ring" style={{ display: 'flex', border: `2px solid #1f2a1f30`, borderRadius: 28, background: '#fff' }}>
                <input
                  ref={inputRef}
                  value={sr.listening ? sr.transcript || input : input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                  placeholder={sr.listening ? 'listening…' : 'speak or type your answer'}
                  style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: 16, padding: '14px 22px', width: 240, fontFamily: T.sans }}
                />
                <button onClick={submit} className="btn-press" style={{ padding: '0 22px', borderRadius: '0 26px 26px 0', border: 'none', background: '#1f2a1f', color: VOICE_BG, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                  Send ↵
                </button>
              </div>

              <button
                onClick={toggleMic}
                disabled={!sr.supported}
                title={sr.supported ? (sr.listening ? 'Stop listening' : 'Speak your answer') : 'Speech recognition not supported in this browser'}
                className="btn-press"
                style={{
                  width: 52, height: 52, borderRadius: 26,
                  border: 'none',
                  background: sr.listening ? ACCENT_SAGE : '#fff',
                  color: sr.listening ? '#fff' : '#1f2a1f',
                  cursor: sr.supported ? 'pointer' : 'not-allowed',
                  opacity: sr.supported ? 1 : 0.4,
                  boxShadow: sr.listening
                    ? `0 0 0 6px ${ACCENT_SAGE}30, 0 8px 24px rgba(0,0,0,0.06)`
                    : '0 1px 4px rgba(0,0,0,0.08), 0 8px 24px rgba(0,0,0,0.06)',
                  display: 'grid', placeItems: 'center',
                  transition: 'all 240ms var(--ease-out-expo)',
                }}
                aria-label={sr.listening ? 'Stop microphone' : 'Start microphone'}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <rect x="6" y="2" width="8" height="13" rx="4" fill="currentColor" />
                  <path d="M3 9a7 7 0 0 0 14 0M10 16v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>

              <button
                onClick={repeat}
                disabled={muted || !ttsSupported}
                className="btn-press"
                style={{
                  padding: '14px 18px', borderRadius: 28,
                  border: '1px solid #1f2a1f30', background: 'transparent',
                  fontSize: 14, fontWeight: 500,
                  cursor: muted ? 'not-allowed' : 'pointer',
                  opacity: muted ? 0.4 : 1,
                }}
              >
                Repeat
              </button>

              <button
                onClick={toggleMute}
                className="btn-press"
                style={{
                  padding: '14px 18px', borderRadius: 28,
                  border: '1px solid #1f2a1f30', background: muted ? '#1f2a1f' : 'transparent',
                  color: muted ? VOICE_BG : '#1f2a1f',
                  fontSize: 14, fontWeight: 500, cursor: 'pointer',
                }}
              >
                {muted ? '🔇 Muted' : '🔊 Mute'}
              </button>

              <button
                onClick={() => onComplete({ mode: 'Voice', solved, durationSec: elapsed })}
                className="btn-press"
                style={{
                  padding: '14px 22px', borderRadius: 28, border: 'none',
                  background: '#1f2a1f', color: VOICE_BG,
                  fontSize: 14, fontWeight: 500, cursor: 'pointer',
                  display: 'flex', gap: 10, alignItems: 'center',
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 4, background: '#ff5b5b' }} />
                End session
              </button>
            </div>

            {sr.error && (
              <div style={{ fontSize: 12, color: '#b04a3a', maxWidth: 360, textAlign: 'center' }}>
                {sr.error}
              </div>
            )}
            {sr.supported && sr.lastHeard && !sr.listening && (
              <div style={{
                fontSize: 11,
                opacity: 0.6,
                fontFamily: T.mono,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                marginTop: 4,
              }}>
                heard: <span style={{ color: '#1f2a1f', textTransform: 'none', fontFamily: T.sans, letterSpacing: 0 }}>"{sr.lastHeard}"</span>
              </div>
            )}
          </div>
        </div>

        <aside className="voice-aside" style={{ background: '#fff', padding: '28px', display: 'flex', flexDirection: 'column', borderLeft: '1px solid #00000010' }}>
          <Kicker style={{ marginBottom: 18 }}>Transcript · live</Kicker>
          <div className="no-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto', flex: 1 }}>
            {transcript.length === 0 && (
              <div style={{ fontSize: 13, opacity: 0.5, lineHeight: 1.55 }}>
                Iris will read each problem aloud. Speak (mic icon) or type your answer.
              </div>
            )}
            {transcript.map((t, i) => (
              <div key={i} style={{ opacity: i < transcript.length - 4 ? 0.4 : 1 }}>
                <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.6, marginBottom: 4, color: t.who === 'AI' ? ACCENT_SAGE : '#1f2a1f', fontFamily: T.mono }}>
                  {t.who}
                </div>
                <div style={{
                  fontSize: t.kind === 'problem' && t.who === 'AI' ? 22 : 16,
                  fontFamily: t.kind === 'problem' ? T.serif : T.sans,
                  letterSpacing: '-0.01em',
                  lineHeight: 1.35,
                  color: t.kind === 'wrong' ? '#b04a3a' : 'inherit',
                }}>
                  {t.text}
                </div>
              </div>
            ))}
            {phase === 'thinking' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: '#1f2a1f', animation: 'pulse-fade 1s infinite' }} />
                <span style={{ fontSize: 13, opacity: 0.5 }}>thinking…</span>
              </div>
            )}
          </div>
        </aside>
      </main>

      <footer style={{ padding: '14px 36px', borderTop: '1px solid #00000010', display: 'flex', justifyContent: 'space-between', fontSize: 11, opacity: 0.55, gap: 12, flexWrap: 'wrap' }}>
        <span>↵ submit · Esc pause</span>
        {voice && <span style={{ fontFamily: T.mono, letterSpacing: '0.1em' }}>{voice.name}</span>}
      </footer>
    </div>
  );
}
