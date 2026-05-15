/**
 * Challenge Grade Flow — modal that handles the full post-card journey:
 *   photo capture  →  upload + Mathpix + grade  →  reveal verdict  →
 *   (optional) LaTeX render of work as a typeset PDF  →  share string
 *
 * Triggered by DailyChallengeCard's "Snap your work to grade →" CTA. Closes
 * on backdrop click or Esc. After reveal, the user can optionally render
 * their work as LaTeX (signed-in only, 1/day) or copy a Wordle-style share
 * string.
 *
 * Walkthrough access is intentionally hidden until after submission — the
 * Wordle ritual is "commit, then see."
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { SignedIn, SignedOut, useAuth } from '@clerk/clerk-react';
import { T } from '../design/tokens';
import { Confetti } from './Confetti';

/** Inline KaTeX rendering for short answer strings. See Share.tsx for context. */
function InlineMath({ value }: { value: string }) {
  const html = useMemo(() => {
    const cleaned = value.replace(/^\$+|\$+$/g, '').trim();
    try {
      return katex.renderToString(cleaned, {
        throwOnError: false,
        displayMode: false,
      });
    } catch {
      return cleaned;
    }
  }, [value]);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
import {
  renderChallengeLatex,
  submitChallengeGrade,
  type ChallengeGradeResponse,
  type TodaysChallenge,
} from '../billing/challenge';
import { TurnstileWidget } from './TurnstileWidget';

type FlowState =
  | { kind: 'idle' }
  | { kind: 'grading' }
  | { kind: 'revealed'; response: ChallengeGradeResponse }
  | { kind: 'rendering-latex'; response: ChallengeGradeResponse }
  | { kind: 'rendered-latex'; response: ChallengeGradeResponse; pdfBase64: string };

interface ChallengeGradeFlowProps {
  challenge: TodaysChallenge;
  onClose: () => void;
}

const DIFFICULTY_EMOJI: Record<TodaysChallenge['difficulty'], string> = {
  easy: '🟢',
  mid: '🟡',
  hard: '🟠',
  cumulative: '🔴',
};

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES = 12 * 1024 * 1024; // ~9MB raw photo

export function ChallengeGradeFlow({ challenge, onClose }: ChallengeGradeFlowProps) {
  const { getToken, isSignedIn } = useAuth();
  const [state, setState] = useState<FlowState>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [showLatexConfirm, setShowLatexConfirm] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Body scroll lock while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_TYPES.has(file.type)) {
      setError('That file format is not supported. Use JPEG, PNG, or WebP.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('That image is too large. Try a photo under 9MB.');
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
        // Turnstile token only meaningful for the anonymous path; the worker
        // skips verification entirely when an Authorization header is present.
        turnstileToken: isSignedIn ? undefined : turnstileToken ?? undefined,
      });
      setState({ kind: 'revealed', response });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Grade failed.';
      setError(msg);
      setState({ kind: 'idle' });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function onRenderLatex() {
    if (state.kind !== 'revealed') return;
    setShowLatexConfirm(false);
    setError(null);
    const prevResponse = state.response;
    setState({ kind: 'rendering-latex', response: prevResponse });
    try {
      const { pdfBase64 } = await renderChallengeLatex({ getToken });
      setState({ kind: 'rendered-latex', response: prevResponse, pdfBase64 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'LaTeX render failed.';
      setError(msg);
      setState({ kind: 'revealed', response: prevResponse });
    }
  }

  function downloadLatexPdf(pdfBase64: string) {
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

  const celebrating =
    (state.kind === 'revealed' ||
      state.kind === 'rendering-latex' ||
      state.kind === 'rendered-latex') &&
    state.response.grade.correct;

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="challenge-flow-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(26, 43, 26, 0.42)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        zIndex: 9000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'clamp(8px, 2vh, 24px)',
      }}
    >
      {celebrating && <Confetti />}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 560,
          maxHeight: '100%',
          background: T.paper,
          border: `1px solid ${T.ink}`,
          padding: '28px 22px',
          color: T.ink,
          // The card itself scrolls when content exceeds the viewport. This
          // avoids the iOS Safari quirk where `overflow-y: auto` on a backdrop
          // combined with `backdrop-filter` silently blocks touch scrolling
          // on inner content.
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="btn-press"
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            background: 'transparent',
            border: 'none',
            padding: 6,
            cursor: 'pointer',
            color: T.muted,
            fontSize: 22,
            lineHeight: 1,
          }}
        >
          ×
        </button>

        {/* Kicker stays visible across all stages */}
        <div
          id="challenge-flow-title"
          style={{
            fontFamily: T.mono,
            fontSize: 11,
            letterSpacing: '0.16em',
            color: T.muted,
            textTransform: 'uppercase',
            marginBottom: 8,
          }}
        >
          DAILY #{challenge.challengeNumber} · {DIFFICULTY_EMOJI[challenge.difficulty]}{' '}
          {challenge.difficulty.toUpperCase()}
        </div>
        <h2
          style={{
            fontFamily: T.sans,
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: '-0.015em',
            margin: '0 0 16px',
          }}
        >
          {challenge.courseTitle} · {challenge.topicTitle}
        </h2>

        {/* Stage routing */}
        {state.kind === 'idle' && (
          <IdleStage
            challenge={challenge}
            error={error}
            isSignedIn={!!isSignedIn}
            turnstileToken={turnstileToken}
            onTurnstileSuccess={setTurnstileToken}
            onTurnstileError={() => setTurnstileToken(null)}
            onPickFile={() => fileInputRef.current?.click()}
          />
        )}

        {state.kind === 'grading' && <GradingStage />}

        {(state.kind === 'revealed' ||
          state.kind === 'rendering-latex' ||
          state.kind === 'rendered-latex') && (
          <RevealStage
            challenge={challenge}
            response={state.kind === 'revealed' ? state.response : state.response}
            renderingLatex={state.kind === 'rendering-latex'}
            renderedPdfBase64={state.kind === 'rendered-latex' ? state.pdfBase64 : null}
            error={error}
            onTryLatex={() => setShowLatexConfirm(true)}
            onDownloadPdf={() => state.kind === 'rendered-latex' && downloadLatexPdf(state.pdfBase64)}
          />
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
          capture="environment"
          style={{ display: 'none' }}
          onChange={onFileSelected}
        />
      </div>

      {/* LaTeX confirm modal — the "second click" of the 2-click flow */}
      {showLatexConfirm && (
        <div
          onClick={() => setShowLatexConfirm(false)}
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(26, 43, 26, 0.55)',
            zIndex: 9100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 380,
              width: '100%',
              background: T.paper,
              border: `1px solid ${T.ink}`,
              padding: '22px 20px',
            }}
          >
            <div style={kickerStyle}>RENDER · 1 / DAY</div>
            <h3
              style={{
                fontFamily: T.sans,
                fontSize: 17,
                fontWeight: 700,
                margin: '8px 0 12px',
              }}
            >
              Render your work as a typeset PDF?
            </h3>
            <p style={{ fontSize: 14, color: T.muted, lineHeight: 1.55, margin: '0 0 18px' }}>
              Uses your one free LaTeX render for today's challenge. The PDF is yours to share or download.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => setShowLatexConfirm(false)}
                className="btn-press chamfer"
                style={{
                  flex: 1,
                  background: 'transparent',
                  color: T.ink,
                  border: `1px solid ${T.ink}`,
                  padding: '10px 14px',
                  fontSize: 14,
                  fontFamily: T.sans,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onRenderLatex}
                className="btn-press chamfer"
                style={{
                  flex: 1,
                  background: T.accent,
                  color: T.paper,
                  border: 'none',
                  padding: '10px 14px',
                  fontSize: 14,
                  fontWeight: 600,
                  fontFamily: T.sans,
                  cursor: 'pointer',
                }}
              >
                Render →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Stages ──────────────────────────────────────────────────────────────

function IdleStage({
  challenge,
  error,
  isSignedIn,
  turnstileToken,
  onTurnstileSuccess,
  onTurnstileError,
  onPickFile,
}: {
  challenge: TodaysChallenge;
  error: string | null;
  isSignedIn: boolean;
  turnstileToken: string | null;
  onTurnstileSuccess: (token: string) => void;
  onTurnstileError: () => void;
  onPickFile: () => void;
}) {
  const buttonDisabled = !isSignedIn && !turnstileToken;
  return (
    <>
      <div
        style={{
          fontSize: 16,
          lineHeight: 1.55,
          color: T.ink,
          marginBottom: 18,
          padding: '12px 14px',
          border: `1px solid ${T.hair}`,
          background: T.paper2,
        }}
      >
        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
          {challenge.problemText}
        </ReactMarkdown>
      </div>
      <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.55, margin: '0 0 18px' }}>
        Solve this on paper. When you're ready, snap a photo of your work — Iris will grade it.
      </p>

      <SignedOut>
        <div style={{ marginBottom: 14 }}>
          <TurnstileWidget onSuccess={onTurnstileSuccess} onError={onTurnstileError} />
        </div>
      </SignedOut>

      <button
        type="button"
        onClick={onPickFile}
        disabled={buttonDisabled}
        className="btn-press chamfer"
        style={{
          width: '100%',
          background: buttonDisabled ? T.hair : T.accent,
          color: buttonDisabled ? T.muted : T.paper,
          border: 'none',
          padding: '14px 18px',
          fontSize: 15,
          fontWeight: 600,
          fontFamily: T.sans,
          cursor: buttonDisabled ? 'not-allowed' : 'pointer',
          minHeight: 48,
        }}
      >
        {buttonDisabled ? 'Verify above to continue…' : 'Snap or upload a photo →'}
      </button>
      <SignedOut>
        <p
          style={{
            marginTop: 14,
            fontSize: 12,
            color: T.muted,
            fontFamily: T.mono,
            letterSpacing: '0.06em',
            textAlign: 'center',
          }}
        >
          Sign in to track your streak + render LaTeX
        </p>
      </SignedOut>
      {error && <ErrorRow message={error} />}
    </>
  );
}

function GradingStage() {
  return (
    <div
      style={{
        padding: '32px 12px',
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
    </div>
  );
}

function RevealStage({
  challenge,
  response,
  renderingLatex,
  renderedPdfBase64,
  error,
  onTryLatex,
  onDownloadPdf,
}: {
  challenge: TodaysChallenge;
  response: ChallengeGradeResponse;
  renderingLatex: boolean;
  renderedPdfBase64: string | null;
  error: string | null;
  onTryLatex: () => void;
  onDownloadPdf: () => void;
}) {
  const { grade, streak } = response;
  const shareString = buildShareString(challenge, response);
  const [copied, setCopied] = useState(false);
  // navigator.share is mobile-only (iOS Safari, Android Chrome). Desktop
  // browsers fall through to the clipboard path which is the only thing
  // that makes sense there anyway.
  const canNativeShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function onShareNative() {
    try {
      await navigator.share({
        title: `MathIQ Daily Challenge #${response.challengeNumber}`,
        text: shareString,
      });
    } catch (err) {
      // User cancelled the share sheet — silent. AbortError is the
      // standard signal; ignore.
      if ((err as Error)?.name !== 'AbortError') {
        // Real failure — fall back to clipboard.
        void onCopyShare();
      }
    }
  }

  async function onCopyShare() {
    try {
      await navigator.clipboard.writeText(shareString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Clipboard might be unavailable in some browsers — fallback to select.
      setCopied(false);
    }
  }

  return (
    <>
      <div
        style={{
          padding: '18px 16px',
          border: `1px solid ${T.ink}`,
          background: grade.correct ? T.paper2 : T.paper,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            fontFamily: T.mono,
            fontSize: 11,
            letterSpacing: '0.18em',
            color: T.muted,
            textTransform: 'uppercase',
            marginBottom: 6,
          }}
        >
          {grade.correct ? '✅ CORRECT' : '❌ NOT QUITE'}
        </div>
        {grade.studentAnswer && (
          <div
            style={{
              fontSize: 14,
              color: T.ink,
              marginBottom: 6,
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
          <div style={{ fontSize: 14, color: T.muted, lineHeight: 1.5 }}>
            {grade.feedback}
          </div>
        )}
      </div>

      {/* Streak callout (signed-in only) */}
      <SignedIn>
        {streak && grade.correct && (
          <div
            style={{
              padding: '10px 14px',
              background: streak.freezeConsumed ? T.accent : T.paper2,
              color: streak.freezeConsumed ? T.paper : T.ink,
              border: `1px solid ${streak.freezeConsumed ? T.accent : T.hair}`,
              fontSize: 13,
              marginBottom: 14,
              fontFamily: T.mono,
              letterSpacing: '0.06em',
            }}
          >
            {streak.freezeConsumed ? (
              <>❄ Saved by a freeze · 🔥 {streak.current}-day streak intact</>
            ) : (
              <>🔥 {streak.current}-day streak · Longest: {streak.longest}</>
            )}
          </div>
        )}
      </SignedIn>

      {/* Share string preview + copy */}
      <div
        style={{
          padding: '12px 14px',
          background: T.paper2,
          border: `1px solid ${T.hair}`,
          marginBottom: 14,
        }}
      >
        <div style={kickerStyle}>SHARE</div>
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
          {copied ? '✓ Copied!' : 'Copy to clipboard'}
        </button>
        </div>
      </div>

      {/* LaTeX render — signed-in only */}
      <SignedIn>
        {!renderedPdfBase64 ? (
          <button
            type="button"
            onClick={onTryLatex}
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
            {renderingLatex ? 'Rendering your typeset PDF…' : '✨ Render your work as typeset PDF'}
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
    </>
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

const kickerStyle: React.CSSProperties = {
  fontFamily: T.mono,
  fontSize: 10,
  letterSpacing: '0.18em',
  color: T.muted,
  textTransform: 'uppercase',
};

// ── Helpers ─────────────────────────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result is "data:image/jpeg;base64,..." — strip the prefix
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
  const emoji = DIFFICULTY_EMOJI[challenge.difficulty];
  const verdict = response.grade.correct ? '✅ Solved' : '❌ Not quite';
  const streakLine =
    response.streak && response.streak.current > 0
      ? `\n🔥 ${response.streak.current}-day streak`
      : '';
  // If the worker minted a shareId (signed-in attempts get one) the link
  // resolves to the user's full attempt + LaTeX render. Anonymous attempts
  // share a generic link back to today's challenge.
  const shareUrl = response.shareId
    ? `https://mathiq.io/share/${response.shareId}`
    : `https://mathiq.io/`;
  return [
    `MathIQ #${challenge.challengeNumber} · ${emoji} ${challenge.difficulty.toUpperCase()}`,
    `${challenge.courseTitle} · ${challenge.topicTitle}`,
    `${verdict}${streakLine}`,
    shareUrl,
  ].join('\n');
}
