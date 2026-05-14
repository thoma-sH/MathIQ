import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@clerk/clerk-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { T } from '../design/tokens';
import { fetchSubscriptionState, type Tier } from '../billing/client';
import { isPaid, isPro } from '../walkthroughs/tier';
import {
  HomeworkError,
  transcribeHomework,
  compileLatexPdf,
} from '../walkthroughs/homework';
import type { Route } from '../router';

interface HomeworkProps {
  onNavigate: (route: Route) => void;
}

type UploadState =
  | { kind: 'idle' }
  | { kind: 'transcribing' }
  | { kind: 'done'; hwId: string; mmd: string; title: string }
  | { kind: 'error'; message: string };

type Mode = 'plain' | 'latex';

type LatexState =
  | { kind: 'idle' }
  | { kind: 'compiling' }
  | { kind: 'ready'; pdfBase64: string }
  | { kind: 'failed'; message: string; texSource?: string };

export function Homework({ onNavigate }: HomeworkProps) {
  const { getToken } = useAuth();
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
      // Default title from filename: strip extension, replace separators with spaces.
      const title = file.name
        .replace(/\.(pdf|png|jpe?g|webp)$/i, '')
        .replace(/[_-]+/g, ' ')
        .trim() || 'Homework';
      setState({ kind: 'done', hwId: result.hwId, mmd: result.mmd, title });
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
      onNavigate({ name: 'settings' });
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

  // Tier-gated entry. Plus+ can use Plain; only Pro can use LaTeX.
  if (tierLoaded && !isPaid(tier)) {
    return <UpgradeWall onNavigate={onNavigate} />;
  }

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
        Homework Helper.
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
          onUpgrade={() => onNavigate({ name: 'settings' })}
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
        Takes 5–20 seconds depending on length. Mathpix transcribes every line,
        preserves the math, and hands it to the renderer.
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
        <span style={{ fontSize: 12, color: T.muted, alignSelf: 'center' }}>
          On iPhone: tap Print → pinch the preview → Save to Files.
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
            {mmd}
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

function UpgradeWall({ onNavigate }: { onNavigate: (r: Route) => void }) {
  return (
    <main
      className="responsive-pad"
      style={{ maxWidth: 640, margin: '0 auto', paddingTop: 24, paddingBottom: 96 }}
    >
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
        Homework Helper.
      </h1>
      <p style={{ fontSize: 16, color: T.muted, lineHeight: 1.55, margin: '0 0 20px' }}>
        Turn your handwritten work into a clean PDF you can submit. Available
        with MathIQ+ ($7.99/mo) — includes Pro for the full LaTeX-typeset
        treatment.
      </p>
      <button
        type="button"
        onClick={() => onNavigate({ name: 'settings' })}
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
        See plans →
      </button>
    </main>
  );
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
            {mmd}
          </ReactMarkdown>
        </div>
        <div className="print-footer">MathIQ · mathiq.io</div>
      </article>
    </div>,
    document.body,
  );
}
