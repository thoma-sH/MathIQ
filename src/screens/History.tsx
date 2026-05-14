import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { SignedIn, SignedOut, SignInButton, useAuth } from '@clerk/clerk-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { T } from '../design/tokens';
import {
  deleteHistoryRecord,
  getHistoryRecord,
  listHistory,
  type HistoryListItem,
  type HistoryRecord,
} from '../walkthroughs/history';
import { fetchSubscriptionState, type Tier } from '../billing/client';
import { isPaid } from '../walkthroughs/tier';
import type { Route } from '../router';

interface HistoryProps {
  onNavigate: (route: Route) => void;
}

export function History({ onNavigate }: HistoryProps) {
  return (
    <main
      className="responsive-pad"
      style={{
        maxWidth: 760,
        margin: '0 auto',
        paddingTop: 32,
        paddingBottom: 96,
      }}
    >
      <button
        onClick={() => onNavigate({ name: 'settings' })}
        className="btn-press"
        style={breadcrumb()}
      >
        ← Settings
      </button>

      <h1
        className="reveal reveal-1"
        style={{
          fontFamily: T.sans,
          fontSize: 'clamp(32px, 7vw, 48px)',
          fontWeight: 700,
          lineHeight: 1.0,
          letterSpacing: '-0.025em',
          margin: '0 0 12px',
        }}
      >
        History.
      </h1>
      <p
        className="reveal reveal-2"
        style={{
          fontSize: 16,
          color: T.muted,
          lineHeight: 1.55,
          margin: '0 0 32px',
          maxWidth: 540,
        }}
      >
        Your past walkthroughs, kept for 90 days. Click any to reopen.
      </p>

      <SignedIn>
        <HistoryList onNavigate={onNavigate} />
      </SignedIn>
      <SignedOut>
        <SignedOutCard />
      </SignedOut>
    </main>
  );
}

function HistoryList({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const { getToken } = useAuth();
  const [items, setItems] = useState<HistoryListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedRecord, setExpandedRecord] = useState<HistoryRecord | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [tier, setTier] = useState<Tier | null>(null);
  const [printRecord, setPrintRecord] = useState<HistoryRecord | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await listHistory({ getToken });
        if (!cancelled) setItems(res.items);
      } catch {
        if (!cancelled) setError('Failed to load history.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sub = await fetchSubscriptionState({ getToken });
      if (!cancelled) setTier(sub?.tier ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  // When printRecord becomes truthy, React mounts the PrintHost (as a portal
  // under body); once it's committed, we invoke the print dialog and clear
  // state shortly after so the screen view returns to normal.
  useEffect(() => {
    if (!printRecord) return;
    const printT = setTimeout(() => {
      window.print();
      setTimeout(() => setPrintRecord(null), 200);
    }, 50);
    return () => clearTimeout(printT);
  }, [printRecord]);

  function handlePrint(record: HistoryRecord) {
    setPrintRecord(record);
  }

  async function openDetail(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedRecord(null);
      return;
    }
    setExpandedId(id);
    setExpandedRecord(null);
    setLoadingDetail(true);
    const rec = await getHistoryRecord({ id, getToken });
    setExpandedRecord(rec);
    setLoadingDetail(false);
  }

  async function remove(id: string) {
    setDeletingId(id);
    const ok = await deleteHistoryRecord({ id, getToken });
    setDeletingId(null);
    if (!ok) return;
    setItems((prev) => (prev ?? []).filter((it) => it.id !== id));
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedRecord(null);
    }
  }

  // Group by day for readable scanning. Must be called before any early
  // return — React requires the same hook order on every render.
  const groups = useMemo(() => groupByDay(items ?? []), [items]);

  if (error) {
    return (
      <div role="status" aria-live="polite" style={{ fontSize: 14, color: T.muted, fontFamily: T.mono }}>
        {error}
      </div>
    );
  }
  if (items === null) {
    return <div style={{ fontSize: 13, color: T.muted }}>Loading…</div>;
  }
  if (items.length === 0) {
    return <EmptyState onNavigate={onNavigate} />;
  }

  return (
    <section className="reveal reveal-3">
      {groups.map(([dayLabel, dayItems]) => (
        <div key={dayLabel} style={{ marginBottom: 28 }}>
          <div style={{ ...kicker(), marginBottom: 10 }}>{dayLabel}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {dayItems.map((it) => (
              <HistoryEntry
                key={it.id}
                item={it}
                expanded={expandedId === it.id}
                record={expandedId === it.id ? expandedRecord : null}
                loading={expandedId === it.id && loadingDetail}
                deleting={deletingId === it.id}
                canExportPdf={isPaid(tier)}
                onToggle={() => void openDetail(it.id)}
                onDelete={() => void remove(it.id)}
                onPrint={() => expandedRecord && handlePrint(expandedRecord)}
                onUpgrade={() => onNavigate({ name: 'settings' })}
                onOpenTopic={() =>
                  onNavigate({
                    name: 'topic',
                    courseId: it.courseId,
                    topicId: it.topicId,
                  })
                }
              />
            ))}
          </div>
        </div>
      ))}

      {printRecord && <PrintHost record={printRecord} />}
    </section>
  );
}

function PrintHost({ record }: { record: HistoryRecord }) {
  const created = new Date(record.createdAt).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  // Render directly under document.body so the print-host is a sibling of
  // #root, not a descendant. This lets us hide #root via `display: none` in
  // @media print, collapsing the app layout entirely so the print-host
  // paginates naturally from page 1.
  return createPortal(
    <div className="print-host" aria-hidden>
      <article className="print-doc">
        <h1>{record.topicTitle}</h1>
        <div className="print-meta">
          {record.problem ? `Problem: ${record.problem}` : 'Canonical example'}
          <br />
          Walked through on {created}
          {record.modelUsed ? ` · ${record.modelUsed}` : ''}
        </div>
        <div className="markdown-body">
          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
            {record.walkthrough}
          </ReactMarkdown>
        </div>
        <div className="print-footer">MathIQ · math-iq.vercel.app</div>
      </article>
    </div>,
    document.body,
  );
}

function HistoryEntry({
  item,
  expanded,
  record,
  loading,
  deleting,
  canExportPdf,
  onToggle,
  onDelete,
  onPrint,
  onUpgrade,
  onOpenTopic,
}: {
  item: HistoryListItem;
  expanded: boolean;
  record: HistoryRecord | null;
  loading: boolean;
  deleting: boolean;
  canExportPdf: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onPrint: () => void;
  onUpgrade: () => void;
  onOpenTopic: () => void;
}) {
  return (
    <article
      style={{
        border: `1px solid ${T.ink}`,
        background: T.paper2,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="btn-press"
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: '14px 18px',
          textAlign: 'left',
          cursor: 'pointer',
          fontFamily: 'inherit',
          color: T.ink,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <span style={{ fontSize: 12, fontFamily: T.mono, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.muted }}>
          {item.topicTitle} · {formatTime(item.createdAt)}
        </span>
        <span style={{ fontSize: 15, lineHeight: 1.45, color: T.ink }}>
          {item.problemSnippet ?? <em style={{ color: T.muted }}>Canonical example</em>}
        </span>
      </button>

      {expanded && (
        <div style={{ borderTop: `1px solid ${T.hair}`, padding: '16px 18px' }}>
          {loading && <div style={{ fontSize: 13, color: T.muted }}>Loading…</div>}
          {!loading && record && (
            <>
              <div
                className="markdown-body"
                style={{ fontSize: 15, lineHeight: 1.6 }}
              >
                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                  {record.walkthrough}
                </ReactMarkdown>
              </div>
              <div style={{ display: 'flex', gap: 14, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={onOpenTopic}
                  className="btn-press chamfer"
                  style={{
                    background: T.accent,
                    color: T.paper,
                    border: 'none',
                    padding: '8px 14px',
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: 'pointer',
                    fontFamily: T.sans,
                  }}
                >
                  Open topic →
                </button>
                {canExportPdf ? (
                  <button
                    type="button"
                    onClick={onPrint}
                    className="btn-press chamfer"
                    style={{
                      background: 'transparent',
                      color: T.ink,
                      border: `1px solid ${T.ink}`,
                      padding: '7px 13px',
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: 'pointer',
                      fontFamily: T.sans,
                    }}
                  >
                    Print / Save as PDF
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onUpgrade}
                    className="btn-press"
                    aria-label="Upgrade to MathIQ+ to download walkthroughs as PDF"
                    style={{
                      background: 'transparent',
                      border: `1px dashed ${T.hair}`,
                      padding: '7px 13px',
                      fontSize: 12,
                      fontFamily: T.mono,
                      letterSpacing: '0.08em',
                      color: T.muted,
                      cursor: 'pointer',
                    }}
                  >
                    Save as PDF — Plus →
                  </button>
                )}
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={deleting}
                  className="btn-press"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    fontSize: 12,
                    color: T.muted,
                    cursor: deleting ? 'not-allowed' : 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  {deleting ? 'Removing…' : 'remove from history'}
                </button>
              </div>
            </>
          )}
          {!loading && !record && (
            <div style={{ fontSize: 13, color: T.muted }}>
              That walkthrough couldn't be loaded — it may have expired.
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function EmptyState({ onNavigate }: { onNavigate: (route: Route) => void }) {
  return (
    <section
      className="reveal reveal-3"
      style={{
        padding: '32px 24px',
        border: `1px solid ${T.ink}`,
        background: T.paper2,
      }}
    >
      <div style={kicker()}>NO HISTORY YET</div>
      <p style={{ fontSize: 16, lineHeight: 1.55, margin: '8px 0 16px', maxWidth: 480 }}>
        Walkthroughs you complete will show up here. Try a problem to populate it.
      </p>
      <button
        type="button"
        onClick={() => onNavigate({ name: 'home' })}
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
        Type a problem →
      </button>
    </section>
  );
}

function SignedOutCard() {
  return (
    <section
      className="reveal reveal-3"
      style={{
        padding: '24px 22px',
        border: `1px solid ${T.ink}`,
        background: T.paper2,
      }}
    >
      <div style={kicker()}>SIGN IN TO USE HISTORY</div>
      <p style={{ fontSize: 14, color: T.muted, lineHeight: 1.5, margin: '8px 0 16px' }}>
        Past walkthroughs are saved per account — sign in to start collecting yours.
      </p>
      <SignInButton mode="modal">
        <button
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
          Sign in
        </button>
      </SignInButton>
    </section>
  );
}

function groupByDay(items: HistoryListItem[]): Array<[string, HistoryListItem[]]> {
  const groups = new Map<string, HistoryListItem[]>();
  for (const it of items) {
    const label = dayLabel(it.createdAt);
    const arr = groups.get(label) ?? [];
    arr.push(it);
    groups.set(label, arr);
  }
  return Array.from(groups.entries());
}

function dayLabel(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const today = stripTime(now);
  const yesterday = new Date(today.getTime() - 86_400_000);
  const that = stripTime(d);
  if (that.getTime() === today.getTime()) return 'TODAY';
  if (that.getTime() === yesterday.getTime()) return 'YESTERDAY';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase();
}

function stripTime(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function kicker(): React.CSSProperties {
  return {
    fontFamily: T.mono,
    fontSize: 11,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: T.muted,
  };
}

function breadcrumb(): React.CSSProperties {
  return {
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
  };
}
