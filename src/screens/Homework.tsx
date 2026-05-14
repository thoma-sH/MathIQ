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
  listHomework,
  getHomework as fetchHomework,
  type UncertainFix,
  type HomeworkListEntry,
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
type OutputKind = 'formatted' | 'raw';

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
  const [output, setOutput] = useState<OutputKind>('formatted');
  const [mode, setMode] = useState<Mode>('plain');
  const [latex, setLatex] = useState<LatexState>({ kind: 'idle' });
  const [printing, setPrinting] = useState(false);
  const [trustIris, setTrustIris] = useState<boolean>(() => readBoolPref('mathiq:trustIris'));
  const [tipDismissed, setTipDismissed] = useState<boolean>(() =>
    readBoolPref('mathiq:trustIrisTipDismissed'),
  );
  const [pastHomework, setPastHomework] = useState<HomeworkListEntry[] | null>(null);
  const [openingPast, setOpeningPast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Listen for cross-screen changes to the Trust Iris setting (Settings
  // page updates the localStorage entry directly).
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === 'mathiq:trustIris') {
        setTrustIris(e.newValue === '1');
      }
      if (e.key === 'mathiq:trustIrisTipDismissed') {
        setTipDismissed(e.newValue === '1');
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function dismissTrustIrisTip() {
    setTipDismissed(true);
    writeBoolPref('mathiq:trustIrisTipDismissed', true);
  }

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

  // Past homework — fetched when the user lands on the idle screen.
  useEffect(() => {
    if (!tierLoaded || !isPaid(tier)) return;
    if (state.kind !== 'idle') return;
    let cancelled = false;
    void (async () => {
      const items = await listHomework({ getToken });
      if (!cancelled) setPastHomework(items);
    })();
    return () => {
      cancelled = true;
    };
  }, [tierLoaded, tier, state.kind, getToken]);

  async function reopenPastHomework(entry: HomeworkListEntry) {
    setOpeningPast(entry.hwId);
    try {
      const record = await fetchHomework({ hwId: entry.hwId, getToken });
      if (record) {
        setState({
          kind: 'done',
          hwId: record.hwId,
          mmd: record.mmd,
          title: entry.title,
        });
        setMode('plain');
        setLatex({ kind: 'idle' });
      }
    } finally {
      setOpeningPast(null);
    }
  }

  async function onFile(file: File | null) {
    if (!file) return;
    setState({ kind: 'transcribing' });
    setLatex({ kind: 'idle' });
    try {
      const result = await transcribeHomework({ file, getToken });
      const title = titleFromFilename(file.name);
      const shouldReview = result.uncertain.length > 0 && !trustIris;
      if (shouldReview) {
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
        // No uncertain fixes, OR the user has flipped Trust Iris — all of
        // Claude's suggestions are already applied to `result.mmd`, so we
        // can go straight to done.
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
        <>
          <OutputToggle output={output} onChange={setOutput} />
          {output === 'formatted' ? (
            <>
              <IdleCard
                fileInputRef={fileInputRef}
                onChoose={() => fileInputRef.current?.click()}
                onFile={onFile}
              />
              {!trustIris && !tipDismissed && (
                <TrustIrisTip
                  onOpenSettings={() => onNavigate({ name: 'settings' })}
                  onDismiss={dismissTrustIrisTip}
                />
              )}
            </>
          ) : (
            <RawUploadCard />
          )}
          {output === 'formatted' && pastHomework && pastHomework.length > 0 && (
            <PastHomeworkSection
              entries={pastHomework}
              opening={openingPast}
              onOpen={reopenPastHomework}
            />
          )}
        </>
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

function readBoolPref(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeBoolPref(key: string, value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // ignore — private mode etc.
  }
}

/**
 * Lightweight banner pointing users at the Trust Iris setting in
 * Settings. Replaces the inline checkbox after we moved the setting
 * out of this screen — keeps the discovery without cluttering the
 * upload flow. Dismissed via "Don't show again", persisted to
 * localStorage.
 */
function TrustIrisTip({
  onOpenSettings,
  onDismiss,
}: {
  onOpenSettings: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="note"
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginTop: 14,
        padding: '10px 14px',
        border: `1px dashed ${T.hair}`,
        fontSize: 13,
        color: T.muted,
        lineHeight: 1.5,
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ color: T.ink }}>Tip —</strong> seeing too many
        &ldquo;Did you mean…?&rdquo; prompts?{' '}
        <button
          type="button"
          onClick={onOpenSettings}
          className="btn-press"
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            color: T.accent,
            cursor: 'pointer',
            textDecoration: 'underline',
            fontFamily: 'inherit',
            fontSize: 'inherit',
          }}
        >
          Turn on Trust Iris in Settings
        </button>{' '}
        to skip the review and auto-accept Iris&apos;s suggestions.
      </span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Don't show this tip again"
        className="btn-press"
        style={{
          background: 'transparent',
          border: 'none',
          padding: 4,
          fontSize: 11,
          fontFamily: T.mono,
          letterSpacing: '0.06em',
          color: T.muted,
          cursor: 'pointer',
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}
      >
        Don&apos;t show again
      </button>
    </div>
  );
}

function PastHomeworkSection({
  entries,
  opening,
  onOpen,
}: {
  entries: HomeworkListEntry[];
  opening: string | null;
  onOpen: (entry: HomeworkListEntry) => void;
}) {
  return (
    <section style={{ marginTop: 36 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 10,
        }}
      >
        <h2
          style={{
            fontFamily: T.sans,
            fontSize: 17,
            fontWeight: 700,
            letterSpacing: '-0.01em',
            margin: 0,
          }}
        >
          Past homework
        </h2>
        <span
          style={{
            fontSize: 11,
            fontFamily: T.mono,
            letterSpacing: '0.08em',
            color: T.muted,
          }}
        >
          last 90 days
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {entries.map((e) => (
          <button
            key={e.hwId}
            type="button"
            onClick={() => onOpen(e)}
            disabled={opening !== null}
            className="btn-press"
            style={{
              background: 'transparent',
              border: `1px solid ${T.hair}`,
              padding: '10px 14px',
              fontFamily: T.sans,
              textAlign: 'left',
              cursor: opening !== null ? 'wait' : 'pointer',
              opacity: opening === e.hwId ? 0.5 : 1,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: T.ink }}>{e.title}</span>
              <span
                style={{
                  fontSize: 12,
                  color: T.muted,
                  fontFamily: T.mono,
                  letterSpacing: '0.04em',
                }}
              >
                {relativeDate(e.createdAt)} ·{' '}
                {e.mediaType === 'application/pdf' ? 'PDF' : 'photo'}
              </span>
            </span>
            <span style={{ fontSize: 13, color: T.muted }} aria-hidden>
              {opening === e.hwId ? '…' : '→'}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function relativeDate(ms: number): string {
  const diff = Date.now() - ms;
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return 'today';
  if (diff < 2 * day) return 'yesterday';
  const days = Math.floor(diff / day);
  if (days < 14) return `${days} days ago`;
  if (days < 60) {
    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  }
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function OutputToggle({
  output,
  onChange,
}: {
  output: OutputKind;
  onChange: (o: OutputKind) => void;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontSize: 11,
          fontFamily: T.mono,
          letterSpacing: '0.14em',
          color: T.muted,
          textTransform: 'uppercase',
          marginBottom: 8,
        }}
      >
        Output
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <OutputChip
          active={output === 'formatted'}
          onClick={() => onChange('formatted')}
          label="Formatted"
          sublabel="Iris transcribes + typesets"
        />
        <OutputChip
          active={output === 'raw'}
          onClick={() => onChange('raw')}
          label="Raw scan"
          sublabel="Photos → PDF, no AI"
        />
      </div>
    </div>
  );
}

function OutputChip({
  active,
  onClick,
  label,
  sublabel,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sublabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn-press"
      style={{
        flex: 1,
        background: active ? T.ink : 'transparent',
        color: active ? T.paper : T.ink,
        border: `1px solid ${T.ink}`,
        padding: '10px 14px',
        textAlign: 'left',
        cursor: 'pointer',
        fontFamily: T.sans,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 11, fontFamily: T.mono, letterSpacing: '0.06em', opacity: 0.75 }}>
        {sublabel}
      </div>
    </button>
  );
}

interface RawPage {
  id: string;
  file: File;
  objectUrl: string;
}

function RawUploadCard() {
  const [pages, setPages] = useState<RawPage[]>([]);
  const [title, setTitle] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Revoke object URLs on unmount so the browser releases memory.
  useEffect(() => {
    return () => {
      pages.forEach((p) => URL.revokeObjectURL(p.objectUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addFiles(files: FileList | null) {
    if (!files) return;
    const next: RawPage[] = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue;
      next.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        file: f,
        objectUrl: URL.createObjectURL(f),
      });
    }
    if (next.length === 0) {
      setError('Pick image files (JPG, PNG, WebP, or HEIC).');
      return;
    }
    setError(null);
    setPages((p) => [...p, ...next]);
    // Default title from the first file if user hasn't set one.
    if (!title && next[0]) {
      const cleaned = next[0].file.name
        .replace(/\.(jpe?g|png|webp|heic)$/i, '')
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .trim();
      setTitle(cleaned || 'Homework');
    }
  }

  function removePage(id: string) {
    setPages((p) => {
      const target = p.find((x) => x.id === id);
      if (target) URL.revokeObjectURL(target.objectUrl);
      return p.filter((x) => x.id !== id);
    });
  }

  function movePage(id: string, dir: -1 | 1) {
    setPages((p) => {
      const idx = p.findIndex((x) => x.id === id);
      if (idx < 0) return p;
      const swap = idx + dir;
      if (swap < 0 || swap >= p.length) return p;
      const next = [...p];
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }

  async function generate() {
    if (pages.length === 0) return;
    setError(null);
    setGenerating(true);
    try {
      // Dynamic import keeps jspdf out of the initial bundle.
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ format: 'letter', unit: 'pt', compress: true });
      // Letter page is 612pt × 792pt; reserve 0.5in margin on each side.
      const pageW = 612;
      const pageH = 792;
      const margin = 36;
      const usableW = pageW - 2 * margin;
      const usableH = pageH - 2 * margin;

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const dataUrl = await fileToDataUrl(page.file);
        const dims = await imageDims(dataUrl);
        // Fit image into usable area, preserving aspect ratio.
        const scale = Math.min(usableW / dims.w, usableH / dims.h);
        const drawW = dims.w * scale;
        const drawH = dims.h * scale;
        const x = (pageW - drawW) / 2;
        const y = (pageH - drawH) / 2;
        if (i > 0) doc.addPage();
        const fmt = page.file.type === 'image/png' ? 'PNG' : 'JPEG';
        doc.addImage(dataUrl, fmt, x, y, drawW, drawH);
      }

      const filename = (title.trim() || 'Homework').replace(/[^a-z0-9 _.-]/gi, '') + '.pdf';
      doc.save(filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF generation failed');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section
      style={{
        padding: '20px 22px',
        border: `1px solid ${T.ink}`,
        background: T.paper2,
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp,image/heic"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          addFiles(e.target.files);
          if (e.target) e.target.value = '';
        }}
      />

      {pages.length === 0 ? (
        <>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
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
            Pick photos →
          </button>
          <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.55, margin: '14px 0 0' }}>
            Snap each page of your handwritten work. We'll combine them into a
            single PDF you can submit — no AI, no transcription, just your
            actual work. Pick multiple files at once or add them one at a time.
          </p>
        </>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 12,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontFamily: T.mono,
                letterSpacing: '0.14em',
                color: T.muted,
                textTransform: 'uppercase',
              }}
            >
              {pages.length} page{pages.length === 1 ? '' : 's'}
            </div>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="btn-press"
              style={{
                background: 'transparent',
                border: 'none',
                padding: 0,
                fontSize: 12,
                fontFamily: T.mono,
                letterSpacing: '0.06em',
                color: T.accent,
                cursor: 'pointer',
              }}
            >
              + Add more
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 10,
              marginBottom: 16,
            }}
          >
            {pages.map((p, i) => (
              <PageThumbnail
                key={p.id}
                page={p}
                index={i}
                total={pages.length}
                onMoveUp={() => movePage(p.id, -1)}
                onMoveDown={() => movePage(p.id, 1)}
                onRemove={() => removePage(p.id)}
              />
            ))}
          </div>

          <label
            style={{
              display: 'block',
              fontSize: 11,
              fontFamily: T.mono,
              letterSpacing: '0.14em',
              color: T.muted,
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            Filename
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Homework"
            style={{
              width: '100%',
              background: T.paper,
              border: `1px solid ${T.ink}`,
              padding: '8px 12px',
              fontSize: 14,
              fontFamily: T.sans,
              color: T.ink,
              marginBottom: 14,
            }}
          />

          <button
            type="button"
            onClick={() => void generate()}
            disabled={generating}
            className="btn-press chamfer"
            style={{
              background: T.accent,
              color: T.paper,
              border: 'none',
              padding: '12px 22px',
              fontSize: 15,
              fontWeight: 600,
              cursor: generating ? 'wait' : 'pointer',
              fontFamily: T.sans,
              opacity: generating ? 0.7 : 1,
            }}
          >
            {generating ? 'Building PDF…' : 'Generate PDF →'}
          </button>
        </>
      )}

      {error && (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginTop: 12,
            padding: '8px 12px',
            border: `1px solid ${T.ink}`,
            background: T.paper,
            fontSize: 13,
            fontFamily: T.mono,
          }}
        >
          {error}
        </div>
      )}
    </section>
  );
}

function PageThumbnail({
  page,
  index,
  total,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  page: RawPage;
  index: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      style={{
        position: 'relative',
        border: `1px solid ${T.ink}`,
        background: T.paper,
        overflow: 'hidden',
      }}
    >
      <img
        src={page.objectUrl}
        alt={`Page ${index + 1}`}
        style={{
          width: '100%',
          height: 160,
          objectFit: 'cover',
          display: 'block',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 6,
          left: 6,
          background: T.ink,
          color: T.paper,
          padding: '2px 8px',
          fontSize: 11,
          fontFamily: T.mono,
          letterSpacing: '0.04em',
        }}
      >
        {index + 1}
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove page"
        className="btn-press"
        style={{
          position: 'absolute',
          top: 4,
          right: 4,
          background: T.paper,
          color: T.ink,
          border: `1px solid ${T.ink}`,
          width: 24,
          height: 24,
          padding: 0,
          fontSize: 14,
          lineHeight: 1,
          cursor: 'pointer',
        }}
      >
        ×
      </button>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: 4,
          borderTop: `1px solid ${T.hair}`,
        }}
      >
        <button
          type="button"
          onClick={onMoveUp}
          disabled={index === 0}
          aria-label="Move page up"
          className="btn-press"
          style={{
            background: 'transparent',
            border: 'none',
            padding: '2px 8px',
            fontSize: 14,
            cursor: index === 0 ? 'default' : 'pointer',
            color: index === 0 ? T.muted : T.ink,
            opacity: index === 0 ? 0.4 : 1,
          }}
        >
          ↑
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={index === total - 1}
          aria-label="Move page down"
          className="btn-press"
          style={{
            background: 'transparent',
            border: 'none',
            padding: '2px 8px',
            fontSize: 14,
            cursor: index === total - 1 ? 'default' : 'pointer',
            color: index === total - 1 ? T.muted : T.ink,
            opacity: index === total - 1 ? 0.4 : 1,
          }}
        >
          ↓
        </button>
      </div>
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}

function imageDims(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error('Failed to load image dimensions'));
    img.src = dataUrl;
  });
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
          Two steps: Iris drafts a publication-quality LaTeX document from
          your transcription, then TeXLive.net typesets it into a PDF.
          Usually 20–40 seconds total.
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
