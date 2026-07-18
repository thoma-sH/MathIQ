/**
 * Daily Challenge page (/daily).
 *
 * Wordle-style ritual: one problem visible to everyone, no walkthrough access
 * before submission. Two entry modes (Photo / Typed) selected via tab toggle.
 * Signed-in users get streak tracking + a 1/day LaTeX render (Pro). Anonymous
 * users see Turnstile verification before grading.
 *
 * Replaces the older ChallengeGradeFlow modal. Reached from the daily button
 * on Landing; the URL is a first-class deep link so shared bookmarks resolve.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import katex from 'katex';
import { SignedIn, SignedOut, useAuth } from '@clerk/clerk-react';
import { kicker as kickerStyle } from '../design/primitives';
import { MathMarkdown } from '../components/MathMarkdown';
import { useAsync } from '../hooks/useAsync';

// Local: DailyChallenge's kicker historically had no marginBottom —
// callers override via spread. Pin to 0 to preserve.
const kicker = () => kickerStyle(0);
import { T } from '../design/tokens';
import {
  CheckIcon,
  CrossIcon,
  DifficultyChip,
  difficultyLabel,
  type DifficultyTier,
} from '../design/icons';
import { Confetti } from '../components/Confetti';
import { TurnstileWidget } from '../components/TurnstileWidget';
import {
  fetchTodaysChallenge,
  fetchStreak,
  submitChallengeGrade,
  renderChallengeLatex,
  type ChallengeGradeResponse,
  type StreakState,
  type TodaysChallenge,
} from '../billing/challenge';

type EntryMode = 'photo' | 'typed';
type FlowState =
  | { kind: 'idle' }
  | { kind: 'grading' }
  | { kind: 'revealed'; response: ChallengeGradeResponse }
  | { kind: 'rendering-latex'; response: ChallengeGradeResponse }
  | { kind: 'rendered-latex'; response: ChallengeGradeResponse; pdfBase64: string };

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_TYPED_CHARS = 2000;
/** Streak milestones that fire confetti in addition to the first-correct hit. */
const STREAK_MILESTONES = new Set([3, 7, 14, 30, 60, 100]);

export function DailyChallenge() {
  const { getToken, isSignedIn } = useAuth();
  const challengeAsync = useAsync(async (signal) => {
    const c = await fetchTodaysChallenge(signal);
    if (!c) throw new Error("Today's challenge is loading — try again in a moment.");
    return c;
  }, []);
  const challenge = challengeAsync.data;
  const loading = challengeAsync.loading;
  const loadError = challengeAsync.error?.message ?? null;
  const [mode, setMode] = useState<EntryMode>('photo');
  const [state, setState] = useState<FlowState>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [typedAnswer, setTypedAnswer] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [idleStreak, setIdleStreak] = useState<StreakState | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Streak is signed-in only (the worker rejects /api/streak without auth).
  // Fetched up front so the panel is on screen before the user solves, not
  // only on the reveal screen.
  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    void fetchStreak({ getToken }).then((s) => {
      if (!cancelled && s) setIdleStreak(s);
    });
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, getToken]);

  async function gradeWithImage(file: File) {
    if (!ALLOWED_TYPES.has(file.type)) {
      setError('That file format is not supported. Use JPEG, PNG, or WebP.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('That image is too large. Try a photo under 12MB.');
      return;
    }
    setError(null);
    setState({ kind: 'grading' });
    try {
      const base64 = await fileToBase64(file);
      const response = await submitChallengeGrade({
        image: base64,
        mediaType: file.type,
        getToken: isSignedIn ? getToken : undefined,
        // Worker skips Turnstile entirely when an Authorization header is present.
        turnstileToken: isSignedIn ? undefined : turnstileToken ?? undefined,
      });
      setState({ kind: 'revealed', response });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Grade failed.');
      setState({ kind: 'idle' });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function gradeWithTyped() {
    const trimmed = typedAnswer.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_TYPED_CHARS) {
      setError(`Keep your answer under ${MAX_TYPED_CHARS} characters.`);
      return;
    }
    setError(null);
    setState({ kind: 'grading' });
    try {
      const response = await submitChallengeGrade({
        studentAnswer: trimmed,
        getToken: isSignedIn ? getToken : undefined,
        turnstileToken: isSignedIn ? undefined : turnstileToken ?? undefined,
      });
      setState({ kind: 'revealed', response });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Grade failed.');
      setState({ kind: 'idle' });
    }
  }

  async function onRenderLatex() {
    if (state.kind !== 'revealed') return;
    setError(null);
    const prev = state.response;
    setState({ kind: 'rendering-latex', response: prev });
    try {
      const { pdfBase64 } = await renderChallengeLatex({ getToken });
      setState({ kind: 'rendered-latex', response: prev, pdfBase64 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'LaTeX render failed.');
      setState({ kind: 'revealed', response: prev });
    }
  }

  function downloadLatexPdf(pdfBase64: string) {
    if (!challenge) return;
    const blob = b64ToBlob(pdfBase64, 'application/pdf');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mathiq-challenge-${challenge.date}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const revealedResponse =
    state.kind === 'revealed' || state.kind === 'rendering-latex' || state.kind === 'rendered-latex'
      ? state.response
      : null;
  const celebrating = !!revealedResponse?.grade.correct;
  const streakMilestone =
    celebrating &&
    !!revealedResponse?.streak?.current &&
    STREAK_MILESTONES.has(revealedResponse.streak.current);

  return (
    <main
      className="responsive-pad page-enter"
      style={{
        maxWidth: 720,
        margin: '0 auto',
        paddingTop: 32,
        paddingBottom: 96,
        minHeight: '100vh',
      }}
    >
      {(celebrating || streakMilestone) && <Confetti />}

      <a
        href="/"
        className="btn-press"
        style={{
          display: 'inline-block',
          fontSize: 13,
          fontFamily: T.mono,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: T.muted,
          textDecoration: 'none',
          marginBottom: 24,
        }}
      >
        ← MathIQ
      </a>

      {loading && <Skeleton />}

      {loadError && (
        <ErrorBlock message={loadError} />
      )}

      {challenge && (
        <>
          <Header challenge={challenge} />
          <ProblemBlock problemText={challenge.problemText} />

          <SignedIn>
            {(state.kind === 'idle' || state.kind === 'grading') && idleStreak && (
              <StreakPanel streak={idleStreak} />
            )}
          </SignedIn>

          {state.kind === 'idle' && (
            <IdleStage
              mode={mode}
              setMode={setMode}
              isSignedIn={!!isSignedIn}
              turnstileToken={turnstileToken}
              onTurnstileSuccess={setTurnstileToken}
              onTurnstileError={() => setTurnstileToken(null)}
              typedAnswer={typedAnswer}
              setTypedAnswer={setTypedAnswer}
              onPickFile={() => fileInputRef.current?.click()}
              onTypedSubmit={gradeWithTyped}
              error={error}
            />
          )}

          {state.kind === 'grading' && <GradingStage />}

          {revealedResponse && (
            <RevealStage
              challenge={challenge}
              response={revealedResponse}
              renderingLatex={state.kind === 'rendering-latex'}
              renderedPdfBase64={state.kind === 'rendered-latex' ? state.pdfBase64 : null}
              error={error}
              onRenderLatex={onRenderLatex}
              onDownloadPdf={() =>
                state.kind === 'rendered-latex' && downloadLatexPdf(state.pdfBase64)
              }
            />
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void gradeWithImage(file);
            }}
          />
        </>
      )}
    </main>
  );
}

// ── Header ──────────────────────────────────────────────────────────────

function Header({ challenge }: { challenge: TodaysChallenge }) {
  return (
    <header style={{ marginBottom: 22 }}>
      <div
        className="reveal reveal-1"
        style={{
          fontFamily: T.mono,
          fontSize: 11,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: T.muted,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span>MATHIQ DAILY · #{challenge.challengeNumber}</span>
        <span aria-hidden>·</span>
        <DifficultyChip tier={challenge.difficulty} />
      </div>
      <h1
        className="reveal reveal-2"
        style={{
          fontFamily: T.sans,
          fontSize: 'clamp(26px, 5vw, 36px)',
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: '-0.02em',
          margin: '10px 0 4px',
        }}
      >
        {challenge.courseTitle} · {challenge.topicTitle}
      </h1>
      <p
        style={{
          fontSize: 13,
          color: T.muted,
          margin: 0,
          fontFamily: T.mono,
          letterSpacing: '0.06em',
        }}
      >
        {formatDate(challenge.date)}
      </p>
    </header>
  );
}

function ProblemBlock({ problemText }: { problemText: string }) {
  return (
    <section
      className="reveal reveal-3"
      style={{
        padding: '20px 22px',
        border: `1px solid ${T.ink}`,
        background: T.paper2,
        marginBottom: 22,
      }}
    >
      <div style={kicker()}>THE PROBLEM</div>
      <MathMarkdown
        style={{ marginTop: 10, fontSize: 17, lineHeight: 1.55, color: T.ink }}
      >
        {problemText}
      </MathMarkdown>
    </section>
  );
}

// ── Idle stage (tab toggle + Photo or Typed entry) ──────────────────────

function IdleStage({
  mode,
  setMode,
  isSignedIn,
  turnstileToken,
  onTurnstileSuccess,
  onTurnstileError,
  typedAnswer,
  setTypedAnswer,
  onPickFile,
  onTypedSubmit,
  error,
}: {
  mode: EntryMode;
  setMode: (m: EntryMode) => void;
  isSignedIn: boolean;
  turnstileToken: string | null;
  onTurnstileSuccess: (token: string) => void;
  onTurnstileError: () => void;
  typedAnswer: string;
  setTypedAnswer: (v: string) => void;
  onPickFile: () => void;
  onTypedSubmit: () => void;
  error: string | null;
}) {
  const verifiedAnon = !isSignedIn && !turnstileToken;
  const typedDisabled = mode === 'typed' && (!typedAnswer.trim() || verifiedAnon);
  const photoDisabled = mode === 'photo' && verifiedAnon;

  return (
    <section className="reveal reveal-4">
      <TabToggle mode={mode} setMode={setMode} />

      <SignedOut>
        <div style={{ marginTop: 14, marginBottom: 14 }}>
          <TurnstileWidget onSuccess={onTurnstileSuccess} onError={onTurnstileError} />
        </div>
      </SignedOut>

      {mode === 'photo' ? (
        <button
          type="button"
          onClick={onPickFile}
          disabled={photoDisabled}
          className="btn-press chamfer"
          style={primaryButton(photoDisabled)}
        >
          {photoDisabled ? 'Verify above to continue' : 'Snap or upload a photo →'}
        </button>
      ) : (
        <>
          <textarea
            value={typedAnswer}
            onChange={(e) => setTypedAnswer(e.target.value)}
            aria-label="Your final answer"
            placeholder="Type your final answer — keep it short. For example: x = 4 or 1/2 or pi/3"
            rows={3}
            maxLength={MAX_TYPED_CHARS}
            style={{
              width: '100%',
              border: `1px solid ${T.ink}`,
              background: T.paper,
              padding: '12px 14px',
              fontSize: 15,
              fontFamily: T.mono,
              resize: 'vertical',
              color: T.ink,
              lineHeight: 1.5,
              marginTop: 16,
              marginBottom: 12,
            }}
          />
          <button
            type="button"
            onClick={onTypedSubmit}
            disabled={typedDisabled}
            className="btn-press chamfer"
            style={primaryButton(typedDisabled)}
          >
            {typedDisabled && verifiedAnon ? 'Verify above to continue' : 'Grade my answer →'}
          </button>
        </>
      )}

      <p style={{ marginTop: 14, fontSize: 13, color: T.muted, lineHeight: 1.55 }}>
        {mode === 'photo'
          ? 'Solve this on paper, snap a photo of your work, and we will grade it.'
          : 'Skip the photo when you only need to submit a final answer.'}
      </p>

      <SignedOut>
        <p
          style={{
            marginTop: 8,
            fontSize: 12,
            color: T.muted,
            fontFamily: T.mono,
            letterSpacing: '0.06em',
          }}
        >
          Sign in to track your streak.
        </p>
      </SignedOut>

      {error && <ErrorRow message={error} />}
    </section>
  );
}

function TabToggle({
  mode,
  setMode,
}: {
  mode: EntryMode;
  setMode: (m: EntryMode) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Choose how to submit your answer"
      style={{
        display: 'inline-flex',
        borderBottom: `1px solid ${T.hair}`,
        gap: 4,
      }}
    >
      <TabButton label="Photo" active={mode === 'photo'} onSelect={() => setMode('photo')} />
      <TabButton label="Typed" active={mode === 'typed'} onSelect={() => setMode('typed')} />
    </div>
  );
}

function TabButton({
  label,
  active,
  onSelect,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      className="btn-press"
      style={{
        background: 'transparent',
        border: 'none',
        padding: '10px 16px 12px',
        fontFamily: T.mono,
        fontSize: 13,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: active ? T.ink : T.muted,
        cursor: 'pointer',
        position: 'relative',
        transition: 'color 220ms ease-out',
      }}
    >
      {label}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: '50%',
          bottom: -1,
          transform: 'translateX(-50%)',
          width: active ? 'calc(100% - 24px)' : '0%',
          height: 2,
          background: T.ink,
          transition: 'width 220ms ease-out',
        }}
      />
    </button>
  );
}

function GradingStage() {
  return (
    <section
      style={{
        padding: '40px 12px',
        textAlign: 'center',
        color: T.muted,
      }}
    >
      <div
        aria-hidden
        style={{
          width: 28,
          height: 28,
          margin: '0 auto 16px',
          borderRadius: '50%',
          border: `3px solid ${T.hair}`,
          borderTopColor: T.ink,
          animation: 'spin 0.9s linear infinite',
        }}
      />
      <div style={{ fontFamily: T.mono, fontSize: 12, letterSpacing: '0.14em' }}>
        READING YOUR WORK · GRADING…
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </section>
  );
}

// ── Reveal stage ─────────────────────────────────────────────────────────

function RevealStage({
  challenge,
  response,
  renderingLatex,
  renderedPdfBase64,
  error,
  onRenderLatex,
  onDownloadPdf,
}: {
  challenge: TodaysChallenge;
  response: ChallengeGradeResponse;
  renderingLatex: boolean;
  renderedPdfBase64: string | null;
  error: string | null;
  onRenderLatex: () => void;
  onDownloadPdf: () => void;
}) {
  const { grade, streak } = response;
  const shareString = buildShareString(challenge, response);
  const [copied, setCopied] = useState(false);
  const canNativeShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function onShareNative() {
    try {
      await navigator.share({
        title: `MathIQ Daily Challenge #${response.challengeNumber}`,
        text: shareString,
      });
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') void onCopyShare();
    }
  }

  async function onCopyShare() {
    try {
      await navigator.clipboard.writeText(shareString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="reveal reveal-1">
      <div
        style={{
          padding: '20px 22px',
          border: `1px solid ${T.ink}`,
          background: grade.correct ? T.paper2 : T.paper,
          marginBottom: 16,
        }}
      >
        <div style={{ ...kicker(), display: 'flex', alignItems: 'center', gap: 8 }}>
          {grade.correct ? (
            <>
              <CheckIcon /> CORRECT
            </>
          ) : (
            <>
              <CrossIcon /> NOT QUITE
            </>
          )}
        </div>
        {grade.studentAnswer && (
          <div
            style={{
              marginTop: 10,
              fontSize: 15,
              color: T.ink,
              display: 'flex',
              alignItems: 'baseline',
              gap: 6,
              flexWrap: 'wrap',
            }}
          >
            <span>Your answer:</span>
            <strong>
              <InlineMath value={grade.studentAnswer} />
            </strong>
          </div>
        )}
        {grade.feedback && (
          <p style={{ marginTop: 6, fontSize: 14, color: T.muted, lineHeight: 1.5 }}>
            {grade.feedback}
          </p>
        )}
      </div>

      <SignedIn>
        {streak && grade.correct && <StreakPanel streak={streak} />}
      </SignedIn>

      <div
        style={{
          padding: '12px 14px',
          background: T.paper2,
          border: `1px solid ${T.hair}`,
          marginBottom: 14,
        }}
      >
        <div style={kicker()}>SHARE</div>
        <pre
          style={{
            fontFamily: T.mono,
            fontSize: 12,
            color: T.ink,
            margin: '6px 0 10px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {shareString}
        </pre>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canNativeShare && (
            <button
              type="button"
              onClick={onShareNative}
              className="btn-press chamfer"
              style={{
                background: T.accent,
                color: T.paper,
                border: 'none',
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 600,
                fontFamily: T.sans,
                cursor: 'pointer',
              }}
            >
              Share →
            </button>
          )}
          <button
            type="button"
            onClick={onCopyShare}
            className="btn-press chamfer"
            style={{
              background: 'transparent',
              color: T.ink,
              border: `1px solid ${T.ink}`,
              padding: '8px 14px',
              fontSize: 13,
              fontFamily: T.sans,
              cursor: 'pointer',
            }}
          >
            {copied ? 'Copied' : 'Copy to clipboard'}
          </button>
        </div>
      </div>

      <SignedIn>
        {!renderedPdfBase64 ? (
          <button
            type="button"
            onClick={onRenderLatex}
            disabled={renderingLatex}
            className="btn-press chamfer"
            style={{
              width: '100%',
              background: 'transparent',
              color: T.accent,
              border: `1px solid ${T.accent}`,
              padding: '12px 16px',
              fontSize: 14,
              fontWeight: 600,
              fontFamily: T.sans,
              cursor: renderingLatex ? 'wait' : 'pointer',
              opacity: renderingLatex ? 0.7 : 1,
              marginBottom: 10,
            }}
          >
            {renderingLatex ? 'Rendering your typeset PDF…' : 'Render your work as typeset PDF'}
          </button>
        ) : (
          <button
            type="button"
            onClick={onDownloadPdf}
            className="btn-press chamfer"
            style={{
              width: '100%',
              background: T.accent,
              color: T.paper,
              border: 'none',
              padding: '12px 16px',
              fontSize: 14,
              fontWeight: 600,
              fontFamily: T.sans,
              cursor: 'pointer',
              marginBottom: 10,
            }}
          >
            Download typeset PDF
          </button>
        )}
      </SignedIn>

      {error && <ErrorRow message={error} />}
    </section>
  );
}

// ── Streak panel ─────────────────────────────────────────────────────────
// Big count + last-7-days cell strip + longest/freeze stats + a meter to the
// next milestone. Duolingo's structure drawn in GitHub's filled-square
// language, flat on the pistachio/ink system — no icons beyond geometry.

/** Ascending milestone ladder for the "next milestone" meter. Mirrors
 *  STREAK_MILESTONES (which stays a Set for the confetti check). */
const MILESTONE_LADDER = [3, 7, 14, 30, 60, 100];

/** Whole days since epoch for a YYYY-MM-DD string, in UTC (challenge days
 *  are UTC on the worker). */
function utcDayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

interface DayCell {
  label: string;
  solved: boolean;
  isToday: boolean;
}

/** The last 7 UTC days ending today, marked solved by walking `current`
 *  back from `lastSolvedDate`. A freeze-bridged gap renders as solved —
 *  the panel is a motivator, not an audit log. */
function lastSevenDays(streak: StreakState): DayCell[] {
  const today = utcDayNumber(new Date().toISOString().slice(0, 10));
  const last = streak.lastSolvedDate ? utcDayNumber(streak.lastSolvedDate) : null;
  const cells: DayCell[] = [];
  for (let off = 6; off >= 0; off--) {
    const day = today - off;
    const solved = last !== null && day <= last && day > last - streak.current;
    cells.push({
      label: new Date(day * 86_400_000).toLocaleDateString(undefined, {
        weekday: 'narrow',
        timeZone: 'UTC',
      }),
      solved,
      isToday: off === 0,
    });
  }
  return cells;
}

/** Small geometric diamond for streak freezes. */
function FreezeIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      aria-hidden
      style={{ display: 'inline-block', flexShrink: 0 }}
    >
      <path
        d="M6 1.2 L10.8 6 L6 10.8 L1.2 6 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StreakPanel({ streak }: { streak: StreakState }) {
  const solvedToday =
    streak.lastSolvedDate === new Date().toISOString().slice(0, 10);
  const cells = lastSevenDays(streak);
  const started = streak.current > 0;
  const next = MILESTONE_LADDER.find((m) => m > streak.current) ?? null;

  return (
    <section
      aria-label={`Streak: ${streak.current} day${streak.current === 1 ? '' : 's'}. Longest: ${streak.longest}. Freezes left: ${streak.freezes}.`}
      style={{
        border: `1px solid ${T.ink}`,
        background: T.paper2,
        padding: '16px 18px 14px',
        marginBottom: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 84 }}>
          <div
            style={{
              fontFamily: T.sans,
              fontSize: 'clamp(40px, 11vw, 52px)',
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: '-0.03em',
              color: T.ink,
            }}
          >
            {streak.current}
          </div>
          <div
            style={{
              fontFamily: T.mono,
              fontSize: 10,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: T.ink,
              marginTop: 5,
            }}
          >
            {started ? 'day streak' : 'start today'}
          </div>
        </div>

        <div
          aria-label={`Last 7 days: ${cells.filter((c) => c.solved).length} solved`}
          style={{ display: 'flex', gap: 7 }}
        >
          {cells.map((c, i) => (
            <div
              key={i}
              aria-hidden
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span
                style={{
                  width: 24,
                  height: 24,
                  boxSizing: 'border-box',
                  background: c.solved ? T.accent : 'transparent',
                  border: c.isToday
                    ? `2px solid ${T.accent}`
                    : `1px solid ${c.solved ? T.ink : T.hairStrong}`,
                }}
              />
              <span
                style={{
                  fontFamily: T.mono,
                  fontSize: 10,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: T.ink,
                }}
              >
                {c.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: `1px solid ${T.hair}`,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexWrap: 'wrap',
          fontFamily: T.mono,
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: T.ink,
        }}
      >
        <span>Longest · {streak.longest}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <FreezeIcon /> Freeze × {streak.freezes}
        </span>
        {started && (
          <span style={{ color: T.accent, fontWeight: 600 }}>
            {solvedToday ? 'Solved today' : 'Solve today to keep it'}
          </span>
        )}
      </div>

      {next !== null && (
        <div style={{ marginTop: 10 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontFamily: T.mono,
              fontSize: 10,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: T.ink,
              marginBottom: 4,
            }}
          >
            <span>Next milestone</span>
            <span>
              {streak.current} / {next}
            </span>
          </div>
          <div
            aria-hidden
            style={{
              height: 5,
              background: T.hair,
              border: `1px solid ${T.hairStrong}`,
              position: 'relative',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: `${Math.min(100, Math.round((streak.current / next) * 100))}%`,
                background: T.accent,
              }}
            />
          </div>
        </div>
      )}

      {streak.freezeConsumed && (
        <div
          style={{
            marginTop: 12,
            padding: '8px 12px',
            background: T.accent,
            color: T.paper,
            fontFamily: T.mono,
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}
        >
          Freeze used · streak saved
        </div>
      )}
    </section>
  );
}

// ── Misc small parts ─────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div
      style={{
        padding: '24px 22px',
        border: `1px solid ${T.hair}`,
        background: T.paper2,
        opacity: 0.7,
      }}
    >
      <div style={kicker()}>LOADING</div>
      <div style={{ height: 28, width: '60%', background: T.hair, marginTop: 14 }} />
      <div style={{ height: 18, width: '90%', background: T.hair, marginTop: 12 }} />
      <div style={{ height: 18, width: '70%', background: T.hair, marginTop: 6 }} />
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: '24px 22px',
        border: `1px solid ${T.ink}`,
        background: T.paper2,
      }}
    >
      <div style={kicker()}>NOT AVAILABLE</div>
      <p style={{ marginTop: 12, fontSize: 15, color: T.muted, lineHeight: 1.55 }}>
        {message}
      </p>
    </div>
  );
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        marginTop: 12,
        padding: '8px 12px',
        border: `1px solid ${T.ink}`,
        background: T.paper2,
        fontSize: 13,
        fontFamily: T.mono,
        color: T.ink,
      }}
    >
      {message}
    </div>
  );
}

function InlineMath({ value }: { value: string }) {
  const html = useMemo(() => {
    const cleaned = value.replace(/^\$+|\$+$/g, '').trim();
    try {
      return katex.renderToString(cleaned, { throwOnError: false, displayMode: false });
    } catch {
      return cleaned;
    }
  }, [value]);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function primaryButton(disabled: boolean): React.CSSProperties {
  return {
    width: '100%',
    background: disabled ? T.hair : T.accent,
    color: disabled ? T.muted : T.paper,
    border: 'none',
    padding: '14px 18px',
    fontSize: 15,
    fontWeight: 600,
    fontFamily: T.sans,
    cursor: disabled ? 'not-allowed' : 'pointer',
    minHeight: 48,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

function b64ToBlob(b64: string, mediaType: string): Blob {
  const bin = atob(b64);
  const len = bin.length;
  const buf = new Uint8Array(len);
  for (let i = 0; i < len; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mediaType });
}

function buildShareString(challenge: TodaysChallenge, response: ChallengeGradeResponse): string {
  const tier: DifficultyTier = challenge.difficulty;
  const verdict = response.grade.correct ? 'Solved' : 'Attempted';
  const streakLine =
    response.streak && response.streak.current > 0
      ? `\nStreak · ${response.streak.current} day${response.streak.current === 1 ? '' : 's'}`
      : '';
  return [
    `MathIQ #${challenge.challengeNumber} · ${difficultyLabel(tier)}`,
    `${challenge.courseTitle} · ${challenge.topicTitle}`,
    `${verdict}${streakLine}`,
    `https://mathiq.io/share/${response.shareId}`,
  ].join('\n');
}

function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
