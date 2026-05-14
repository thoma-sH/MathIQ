import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@clerk/clerk-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { T } from '../design/tokens';
import { fetchSubscriptionState, type Tier } from '../billing/client';
import { isPaid, isPro } from '../walkthroughs/tier';
import { useUpgradePrompt } from '../upgrade/UpgradePrompt';
import {
  HomeworkError,
  transcribeHomework,
  compileLatexPdf,
  updateHomeworkMmd,
  type UncertainFix,
} from '../walkthroughs/homework';
import type { Route } from '../router';

interface HomeworkProps {
  onNavigate: (route: Route) => void;
}

type UploadState =
  | { kind: 'idle' }
  | { kind: 'transcribing' }
  | {
      kind: 'reviewing';
      hwId: string;
      cleaned: string;
      title: string;
      uncertain: UncertainFix[];
      resolutions: Record<string, Resolution>;
      cursor: number;
    }
  | { kind: 'done'; hwId: string; mmd: string; title: string }
  | { kind: 'error'; message: string };

type Resolution =
  | { kind: 'accepted' }
  | { kind: 'rejected' }
  | { kind: 'edited'; value: string };

type Mode = 'plain' | 'latex';

type LatexState =
  | { kind: 'idle' }
  | { kind: 'compiling' }
  | { kind: 'ready'; pdfBase64: string }
  | { kind: 'failed'; message: string; texSource?: string };

export function Homework({ onNavigate }: HomeworkProps) {
  const { getToken } = useAuth();
  const { requireUpgrade } = useUpgradePrompt();
  const [tier, setTier] = useState<Tier | null>(null);
  const [tierLoaded, setTierLoaded] = useState(false);
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const [mode, setMode] = useState<Mode>('plain');
  const [latex, setLatex] = useState<LatexState>({ kind: 'idle' });
  const [printing, setPrinting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sub = await fetchSubscriptionState({ getToken });
      if (cancelled) return;
      setTier(sub?.tier ?? null);
      setTierLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  useEffect(() => {
    if (!printing) return;
    const t = setTimeout(() => {
      window.print();
      setTimeout(() => setPrinting(false), 200);
    }, 50);
    return () => clearTimeout(t);
  }, [printing]);

  async function onFile(file: File | null) {
    if (!file) return;
    setState({ kind: 'transcribing' });
    setLatex({ kind: 'idle' });
    try {
      const result = await transcribeHomework({ file, getToken });
      const title = titleFromFilename(file.name);
      if (result.uncertain.length > 0) {
        setState({
          kind: 'reviewing',
          hwId: result.hwId,
          cleaned: result.mmd,
          title,
          uncertain: result.uncertain,
          resolutions: {},
          cursor: 0,
        });
      } else {
        setState({ kind: 'done', hwId: result.hwId, mmd: result.mmd, title });
      }
    } catch (err) {
      const msg =
        err instanceof HomeworkError
          ? err.message
          : 'Transcription failed — try again in a moment.';
      setState({ kind: 'error', message: msg });
    }
  }

  async function onCompileLatex(hwId: string, title: string) {
    if (!isPro(tier)) {
      requireUpgrade('homework-latex');
      return;
    }
    setLatex({ kind: 'compiling' });
    try {
      const result = await compileLatexPdf({ hwId, title, getToken });
      setLatex({ kind: 'ready', pdfBase64: result.pdfBase64 });
    } catch (err) {
      if (err instanceof HomeworkError) {
        setLatex({ kind: 'failed', message: err.message, texSource: err.texSource });
      } else {
        setLatex({ kind: 'failed', message: 'LaTeX compile failed — try again in a moment.' });
      }
    }
  }

  // Tier-gated entry. Direct route access by a non-Plus user → bounce to
  // home and surface the upgrade modal.
  useEffect(() => {
    if (tierLoaded && !isPaid(tier)) {
      requireUpgrade('homework-plain');
      onNavigate({ name: 'home' });
    }
  }, [tierLoaded, tier, requireUpgrade, onNavigate]);

  if (tierLoaded && !isPaid(tier)) return null;

  return (
    <main
      className="responsive-pad"
      style={{
        maxWidth: 760,
        margin: '0 auto',
        paddingTop: 24,
        paddingBottom: 96,
      }}
    >
      <button
        onClick={() => onNavigate({ name: 'home' })}
        className="btn-press"
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          fontSize: 13,
          fontFamily: T.mono,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: T.muted,
          cursor: 'pointer',
          marginBottom: 16,
        }}
      >
        ← Back to home
      </button>

      <h1
        style={{
          fontFamily: T.sans,
          fontSize: 'clamp(28px, 6vw, 38px)',
          fontWeight: 700,
          lineHeight: 1.05,
          letterSpacing: '-0.02em',
          margin: '0 0 12px',
        }}
      >
        Handwritten to PDF.
      </h1>
      <p
        style={{
          fontSize: 16,
          color: T.muted,
          lineHeight: 1.55,
          margin: '0 0 24px',
          maxWidth: 560,
        }}
      >
        Upload a PDF or photo of your handwritten work. Iris transcribes it,
        then you can print a clean PDF to turn in
        {isPro(tier) ? ' — or compile a fully typeset LaTeX PDF.' : '.'}
      </p>

      {state.kind === 'idle' && (
        <IdleCard
          fileInputRef={fileInputRef}
          onChoose={() => fileInputRef.current?.click()}
          onFile={onFile}
        />
      )}

      {state.kind === 'transcribing' && <TranscribingCard />}

      {state.kind === 'reviewing' && (
        <ReviewView
          state={state}
          onResolve={(id, resolution) => {
            setState({
              ...state,
              resolutions: { ...state.resolutions, [id]: resolution },
              cursor: Math.min(state.cursor + 1, state.uncertain.length),
            });
          }}
          onSkipRemaining={() => {
            // Accept all unresolved corrections in one click.
            const accepted: Record<string, Resolution> = { ...state.resolutions };
            for (const u of state.uncertain) {
              if (!accepted[u.id]) accepted[u.id] = { kind: 'accepted' };
            }
            setState({
              ...state,
              resolutions: accepted,
              cursor: state.uncertain.length,
            });
          }}
          onFinish={async () => {
            const finalMmd = applyResolutions(state.cleaned, state.uncertain, state.resolutions);
            try {
              await updateHomeworkMmd({ hwId: state.hwId, mmd: finalMmd, getToken });
            } catch {
              // Non-fatal — the cleaned text is good enough to render.
              // Server-side save failure just means corrections aren't
              // persisted across sessions.
            }
            setState({ kind: 'done', hwId: state.hwId, mmd: finalMmd, title: state.title });
          }}
        />
      )}

      {state.kind === 'error' && (
        <ErrorCard
          message={state.message}
          onRetry={() => setState({ kind: 'idle' })}
        />
      )}

      {state.kind === 'done' && (
        <DoneView
          mmd={state.mmd}
          hwId={state.hwId}
          title={state.title}
          mode={mode}
          setMode={setMode}
          tier={tier}
          latex={latex}
          onCompileLatex={() => onCompileLatex(state.hwId, state.title)}
          onPrintPlain={() => setPrinting(true)}
          onNewUpload={() => {
            setState({ kind: 'idle' });
            setLatex({ kind: 'idle' });
          }}
          onUpgrade={() => requireUpgrade('homework-latex')}
        />
      )}

      {printing && state.kind === 'done' && (
        <HomeworkPrintHost mmd={state.mmd} title={state.title} />
      )}
    </main>
  );
}

function IdleCard({
  fileInputRef,
  onChoose,
  onFile,
}: {
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  onChoose: () => void;
  onFile: (f: File | null) => void;
}) {
  return (
    <section
      style={{
        padding: '24px',
        border: `1px solid ${T.ink}`,
        background: T.paper2,
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        onClick={onChoose}
        className="btn-press chamfer"
        style={{
          background: T.accent,
          color: T.paper,
          border: 'none',
          padding: '12px 22px',
          fontSize: 15,
          fontWeight: 500,
          cursor: 'pointer',
          fontFamily: T.sans,
        }}
      >
        Choose file →
      </button>
      <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.55, margin: '14px 0 0' }}>
        PDF (best for multi-page) or a PNG/JPEG photo. Up to 15&nbsp;MB. Shoot
        straight-on with good light, or scan multiple pages into a single PDF
        from your phone's Files app.
      </p>
    </section>
  );
}

/** Apply user resolutions to the cleaned transcription. Each accepted fix
 *  is already in the cleaned text; rejected ones revert to Mathpix's
 *  original; edited ones get the user's typed version. */
function applyResolutions(
  cleaned: string,
  uncertain: UncertainFix[],
  resolutions: Record<string, Resolution>,
): string {
  let out = cleaned;
  for (const fix of uncertain) {
    const r = resolutions[fix.id];
    if (!r || r.kind === 'accepted') continue;
    const replacement = r.kind === 'rejected' ? fix.original : r.value;
    // Targeted replacement: prefer the context window so we don't clobber
    // an unrelated occurrence of the same word elsewhere in the doc.
    const ctxIdx = fix.context ? out.indexOf(fix.context.replace(/\s+/g, ' ').trim()) : -1;
    if (ctxIdx >= 0) {
      const inside = out.slice(ctxIdx, ctxIdx + fix.context.length + 60);
      const localIdx = inside.indexOf(fix.applied);
      if (localIdx >= 0) {
        const absolute = ctxIdx + localIdx;
        out = out.slice(0, absolute) + replacement + out.slice(absolute + fix.applied.length);
        continue;
      }
    }
    const idx = out.indexOf(fix.applied);
    if (idx >= 0) {
      out = out.slice(0, idx) + replacement + out.slice(idx + fix.applied.length);
    }
  }
  return out;
}

function ReviewView({
  state,
  onResolve,
  onSkipRemaining,
  onFinish,
}: {
  state: Extract<UploadState, { kind: 'reviewing' }>;
  onResolve: (id: string, resolution: Resolution) => void;
  onSkipRemaining: () => void;
  onFinish: () => void | Promise<void>;
}) {
  const { uncertain, cursor } = state;
  const total = uncertain.length;
  const allResolved = cursor >= total;
  const fix = uncertain[cursor];
  const [editValue, setEditValue] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setEditing(false);
    setEditValue(fix?.applied ?? '');
  }, [fix?.id, fix?.applied]);

  return (
    <section
      style={{
        padding: '22px 22px 18px',
        border: `1px solid ${T.ink}`,
        background: T.paper2,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontFamily: T.mono,
          letterSpacing: '0.14em',
          color: T.muted,
          textTransform: 'uppercase',
          marginBottom: 14,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>
          {allResolved
            ? `${total} of ${total} reviewed`
            : `Reviewing ${cursor + 1} of ${total}`}
        </span>
        {!allResolved && total > 1 && (
          <button
            type="button"
            onClick={onSkipRemaining}
            className="btn-press"
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              fontSize: 11,
              fontFamily: T.mono,
              letterSpacing: '0.1em',
              color: T.accent,
              cursor: 'pointer',
            }}
          >
            Accept all remaining →
          </button>
        )}
      </div>

      {fix ? (
        <>
          <div style={{ fontSize: 14, color: T.muted, marginBottom: 6 }}>Did you mean</div>
          <div
            style={{
              fontFamily: T.sans,
              fontSize: 'clamp(20px, 3.2vw, 26px)',
              fontWeight: 700,
              letterSpacing: '-0.01em',
              marginBottom: 12,
              wordBreak: 'break-word',
            }}
          >
            “{fix.applied}”
            <span
              style={{
                marginLeft: 10,
                fontSize: 13,
                fontWeight: 400,
                color: T.muted,
                fontFamily: T.mono,
                letterSpacing: '0.04em',
              }}
            >
              instead of “{fix.original}”
            </span>
          </div>

          {fix.context && (
            <div
              style={{
                fontSize: 13,
                color: T.muted,
                fontFamily: T.mono,
                lineHeight: 1.55,
                padding: '10px 12px',
                background: T.paper,
                border: `1px solid ${T.hair}`,
                marginBottom: 10,
              }}
            >
              …{fix.context}…
            </div>
          )}
          {fix.reason && (
            <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.55, marginBottom: 14 }}>
              {fix.reason}
            </div>
          )}

          {!editing ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => onResolve(fix.id, { kind: 'accepted' })}
                className="btn-press chamfer"
                style={{
                  background: T.accent,
                  color: T.paper,
                  border: 'none',
                  padding: '10px 18px',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: T.sans,
                }}
              >
                Yes, use “{truncate(fix.applied, 30)}”
              </button>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="btn-press"
                style={{
                  background: 'transparent',
                  border: `1px solid ${T.ink}`,
                  padding: '10px 14px',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: T.sans,
                }}
              >
                Edit…
              </button>
              <button
                type="button"
                onClick={() => onResolve(fix.id, { kind: 'rejected' })}
                className="btn-press"
                style={{
                  background: 'transparent',
                  border: `1px solid ${T.hair}`,
                  padding: '10px 14px',
                  fontSize: 13,
                  fontWeight: 500,
                  color: T.muted,
                  cursor: 'pointer',
                  fontFamily: T.sans,
                }}
              >
                Keep “{truncate(fix.original, 24)}”
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                autoFocus
                style={{
                  background: T.paper,
                  border: `1px solid ${T.ink}`,
                  padding: '10px 12px',
                  fontSize: 15,
                  fontFamily: T.sans,
                  color: T.ink,
                  width: '100%',
                }}
                placeholder="What should it say?"
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    if (editValue.trim()) {
                      onResolve(fix.id, { kind: 'edited', value: editValue.trim() });
                    }
                  }}
                  className="btn-press chamfer"
                  style={{
                    background: T.accent,
                    color: T.paper,
                    border: 'none',
                    padding: '8px 16px',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: T.sans,
                  }}
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="btn-press"
                  style={{
                    background: 'transparent',
                    border: `1px solid ${T.hair}`,
                    padding: '8px 14px',
                    fontSize: 13,
                    fontFamily: T.sans,
                    cursor: 'pointer',
                    color: T.muted,
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {fix.alternatives.length > 0 && !editing && (
            <div
              style={{
                marginTop: 14,
                paddingTop: 12,
                borderTop: `1px solid ${T.hair}`,
                fontSize: 12,
                color: T.muted,
              }}
            >
              <span style={{ fontFamily: T.mono, letterSpacing: '0.06em' }}>OR — </span>
              {fix.alternatives.map((alt, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onResolve(fix.id, { kind: 'edited', value: alt })}
                  className="btn-press"
                  style={{
                    background: 'transparent',
                    border: `1px dashed ${T.hair}`,
                    padding: '4px 10px',
                    marginRight: 6,
                    fontSize: 12,
                    fontFamily: T.sans,
                    cursor: 'pointer',
                    color: T.ink,
                  }}
                >
                  {alt}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 15, lineHeight: 1.55 }}>
            All set. Saving your corrections and continuing to the PDF.
          </div>
          <button
            type="button"
            onClick={() => void onFinish()}
            className="btn-press chamfer"
            style={{
              alignSelf: 'flex-start',
              background: T.accent,
              color: T.paper,
              border: 'none',
              padding: '10px 18px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: T.sans,
            }}
          >
            Continue →
          </button>
        </div>
      )}
    </section>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

function TranscribingCard() {
  return (
    <section
      style={{
        padding: '24px',
        border: `1px solid ${T.ink}`,
        background: T.paper2,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 600 }}>Iris is reading your work…</div>
      <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.55 }}>
        Two passes: Mathpix transcribes every line and preserves the math,
        then Iris proofreads against the original page to fix typos and
        restore section breaks. Usually 20–45 seconds.
      </div>
    </section>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: '14px 18px',
        border: `1px solid ${T.ink}`,
        background: T.paper2,
        fontSize: 14,
        color: T.ink,
        marginBottom: 18,
      }}
    >
      {message}
      <button
        type="button"
        onClick={onRetry}
        className="btn-press"
        style={{
          marginTop: 10,
          background: 'transparent',
          border: `1px solid ${T.ink}`,
          padding: '8px 14px',
          fontSize: 13,
          fontWeight: 500,
          fontFamily: T.sans,
          cursor: 'pointer',
          display: 'block',
        }}
      >
        Try again
      </button>
    </div>
  );
}

function DoneView({
  mmd,
  title,
  mode,
  setMode,
  tier,
  latex,
  onCompileLatex,
  onPrintPlain,
  onNewUpload,
  onUpgrade,
}: {
  mmd: string;
  hwId: string;
  title: string;
  mode: Mode;
  setMode: (m: Mode) => void;
  tier: Tier | null;
  latex: LatexState;
  onCompileLatex: () => void;
  onPrintPlain: () => void;
  onNewUpload: () => void;
  onUpgrade: () => void;
}) {
  const canLatex = isPro(tier);

  return (
    <>
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 14,
          borderBottom: `1px solid ${T.hair}`,
        }}
      >
        <ModeTab
          active={mode === 'plain'}
          onClick={() => setMode('plain')}
        >
          Plain
        </ModeTab>
        <ModeTab
          active={mode === 'latex'}
          locked={!canLatex}
          onClick={() => {
            if (!canLatex) {
              onUpgrade();
              return;
            }
            setMode('latex');
            if (latex.kind === 'idle') onCompileLatex();
          }}
        >
          LaTeX {canLatex ? '' : '· Pro'}
        </ModeTab>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onNewUpload}
          className="btn-press"
          style={{
            background: 'transparent',
            border: 'none',
            padding: '8px 10px',
            fontSize: 12,
            fontFamily: T.mono,
            letterSpacing: '0.1em',
            color: T.muted,
            cursor: 'pointer',
            textTransform: 'uppercase',
          }}
        >
          Upload new →
        </button>
      </div>

      {mode === 'plain' && (
        <PlainView mmd={mmd} title={title} onPrint={onPrintPlain} />
      )}

      {mode === 'latex' && canLatex && (
        <LatexView state={latex} onRetry={onCompileLatex} title={title} />
      )}
    </>
  );
}

function ModeTab({
  active,
  locked,
  onClick,
  children,
}: {
  active: boolean;
  locked?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn-press"
      style={{
        background: 'transparent',
        border: 'none',
        borderBottom: active ? `2px solid ${T.ink}` : '2px solid transparent',
        padding: '10px 14px',
        marginBottom: -1,
        fontSize: 14,
        fontWeight: active ? 600 : 500,
        color: locked ? T.muted : T.ink,
        cursor: 'pointer',
        fontFamily: T.sans,
      }}
    >
      {children}
    </button>
  );
}

function PlainView({
  mmd,
  title,
  onPrint,
}: {
  mmd: string;
  title: string;
  onPrint: () => void;
}) {
  return (
    <>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={onPrint}
          className="btn-press chamfer"
          style={{
            background: T.accent,
            color: T.paper,
            border: 'none',
            padding: '10px 18px',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: T.sans,
          }}
        >
          Print / Save as PDF →
        </button>
        <span style={{ fontSize: 12, color: T.muted, alignSelf: 'center', lineHeight: 1.5 }}>
          iPhone: tap Print → pinch the preview → Save to Files. Chrome / Edge:
          in the print dialog, turn off &ldquo;Headers and footers&rdquo; under
          More settings for a cleaner page.
        </span>
      </div>
      <article
        style={{
          padding: '18px 22px',
          border: `1px solid ${T.ink}`,
          background: T.paper,
        }}
      >
        <h2
          style={{
            fontFamily: T.sans,
            fontSize: 18,
            fontWeight: 700,
            margin: '0 0 14px',
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </h2>
        <div className="markdown-body" style={{ fontSize: 15, lineHeight: 1.6 }}>
          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
            {normalizeMmdForReact(mmd)}
          </ReactMarkdown>
        </div>
      </article>
    </>
  );
}

function LatexView({
  state,
  onRetry,
  title,
}: {
  state: LatexState;
  onRetry: () => void;
  title: string;
}) {
  if (state.kind === 'idle' || state.kind === 'compiling') {
    return (
      <section
        style={{
          padding: '24px',
          border: `1px solid ${T.ink}`,
          background: T.paper2,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
          Compiling your LaTeX PDF…
        </div>
        <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.55 }}>
          TeXLive.net is typesetting your work. This usually takes 10–20 seconds.
        </div>
      </section>
    );
  }

  if (state.kind === 'failed') {
    return (
      <section
        style={{
          padding: '18px 22px',
          border: `1px solid ${T.ink}`,
          background: T.paper2,
        }}
      >
        <div style={{ fontSize: 15, marginBottom: 10 }}>{state.message}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onRetry}
            className="btn-press"
            style={{
              background: 'transparent',
              border: `1px solid ${T.ink}`,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 500,
              fontFamily: T.sans,
              cursor: 'pointer',
            }}
          >
            Try compile again
          </button>
          {state.texSource && (
            <button
              type="button"
              onClick={() => downloadText(state.texSource!, `${title}.tex`)}
              className="btn-press"
              style={{
                background: 'transparent',
                border: `1px solid ${T.ink}`,
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 500,
                fontFamily: T.sans,
                cursor: 'pointer',
              }}
            >
              Download .tex source
            </button>
          )}
        </div>
      </section>
    );
  }

  // state.kind === 'ready'
  return <CompiledPdfView pdfBase64={state.pdfBase64} title={title} />;
}

function CompiledPdfView({ pdfBase64, title }: { pdfBase64: string; title: string }) {
  const blobUrl = useMemo(() => {
    const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'application/pdf' });
    return URL.createObjectURL(blob);
  }, [pdfBase64]);

  useEffect(() => {
    return () => URL.revokeObjectURL(blobUrl);
  }, [blobUrl]);

  // iOS Safari can't render inline PDFs reliably — Download is the primary
  // action; iframe preview is best-effort.
  const isIos = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return /iPad|iPhone|iPod/.test(navigator.userAgent);
  }, []);

  return (
    <>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <a
          href={blobUrl}
          download={`${title}.pdf`}
          className="btn-press chamfer"
          style={{
            background: T.accent,
            color: T.paper,
            border: 'none',
            padding: '10px 18px',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: T.sans,
            textDecoration: 'none',
            display: 'inline-block',
          }}
        >
          Download PDF →
        </a>
        <span style={{ fontSize: 12, color: T.muted, alignSelf: 'center' }}>
          Typeset with Computer Modern via TeXLive.net.
        </span>
      </div>
      {!isIos && (
        <iframe
          src={blobUrl}
          title="Compiled LaTeX PDF"
          style={{
            width: '100%',
            height: '70vh',
            border: `1px solid ${T.ink}`,
            background: T.paper,
          }}
        />
      )}
    </>
  );
}

function downloadText(text: string, filename: string) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Default printable title from the source filename.
 *
 *   "ThomasHamiltonHW5-1.pdf"  →  "Thomas Hamilton HW5 1"
 *   "calc_problem_set_2.png"   →  "Calc Problem Set 2"
 *
 * Strip extension, split CamelCase, replace separator chars with spaces,
 * trim, fall back to "Homework" if nothing's left.
 */
function titleFromFilename(name: string): string {
  return (
    name
      .replace(/\.(pdf|png|jpe?g|webp)$/i, '')
      // Split before any uppercase that follows a lowercase ("aB" → "a B")
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      // Normalize separator characters to single spaces.
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Homework'
  );
}

/**
 * Coerce Mathpix Markdown into a shape react-markdown + remark-math can render.
 *
 * Mathpix's `.mmd` is a superset of markdown with two patterns that break
 * the standard pipeline:
 *
 *   1. Display math `$$ ... $$` is emitted INLINE alongside prose with no
 *      surrounding blank lines. remark-math then tokenizes it as inline
 *      math, where `\begin{aligned}` is invalid — KaTeX dumps the source
 *      in red text. Forcing display blocks onto their own paragraph fixes
 *      ~80% of the rendering damage we saw on real handwriting submissions.
 *
 *   2. Mathpix-specific text commands (\section, \subsection) appear at the
 *      document level (not inside math) and have no analogue in standard
 *      markdown. Convert them to `##` / `###` headers.
 */
function normalizeMmdForReact(mmd: string): string {
  let s = mmd;

  // Mathpix text-mode commands → markdown headers.
  s = s.replace(/\\subsubsection\*?\{([^}]+)\}/g, '\n\n#### $1\n\n');
  s = s.replace(/\\subsection\*?\{([^}]+)\}/g, '\n\n### $1\n\n');
  s = s.replace(/\\section\*?\{([^}]+)\}/g, '\n\n## $1\n\n');

  // Wrap every $$ ... $$ block in blank lines so remark-math parses it as
  // display math instead of inline. The `[\s\S]*?` is non-greedy so adjacent
  // $$ pairs don't merge into one giant block.
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_m, body) => `\n\n$$\n${body.trim()}\n$$\n\n`);

  // Collapse the runs of blank lines our inserts can create.
  s = s.replace(/\n{3,}/g, '\n\n');

  return s;
}

function HomeworkPrintHost({ mmd, title }: { mmd: string; title: string }) {
  const date = new Date().toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  return createPortal(
    <div className="print-host" aria-hidden>
      <article className="homework-doc">
        <header className="homework-header">
          <h1 className="homework-title">{title}</h1>
          <div className="homework-meta">Submitted {date}</div>
        </header>
        <div className="markdown-body homework-body">
          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
            {normalizeMmdForReact(mmd)}
          </ReactMarkdown>
        </div>
        <div className="print-footer">MathIQ · mathiq.io</div>
      </article>
    </div>,
    document.body,
  );
}
