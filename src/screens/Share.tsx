/**
 * Public read-only view of a shared Daily Challenge attempt.
 *
 * Lands here from a /share/:id deep link (typically tapped from someone's
 * social post). Shows the challenge problem, the sharer's grade, and if
 * they rendered a typeset PDF — the PDF embedded inline as the centerpiece.
 *
 * No auth required. Anonymous viewers see the same content as signed-in.
 * Privacy: the page never reveals the sharer's userId or identity.
 */
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { T } from '../design/tokens';
import { CheckIcon, CrossIcon, DifficultyChip } from '../design/icons';
import {
  fetchSharedAttempt,
  type SharedChallenge,
} from '../billing/challenge';

/**
 * Render a short LaTeX string inline (no block wrapper). Used for the
 * one-liner "their answer" callouts — the grader emits things like
 * "x = 4" or "x = \\frac{1}{2}" without delimiters, so we strip any
 * stray $ from the edges and ask KaTeX to render in inline mode.
 *
 * If KaTeX fails (malformed input), falls back to the raw string so
 * the page never goes blank.
 */
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

interface ShareProps {
  shareId: string;
}

export function Share({ shareId }: ShareProps) {
  const [data, setData] = useState<SharedChallenge | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchSharedAttempt(shareId).then((d) => {
      if (cancelled) return;
      if (!d) {
        setError("This shared challenge expired or wasn't found.");
      } else {
        setData(d);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [shareId]);

  return (
    <main
      className="responsive-pad"
      style={{
        maxWidth: 760,
        margin: '0 auto',
        paddingTop: 32,
        paddingBottom: 80,
        minHeight: '100vh',
      }}
    >
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

      {loading && <LoadingState />}

      {error && (
        <div
          style={{
            padding: '24px 22px',
            border: `1px solid ${T.ink}`,
            background: T.paper2,
          }}
        >
          <div style={kicker()}>SHARED CHALLENGE</div>
          <p style={{ marginTop: 12, fontSize: 15, color: T.muted, lineHeight: 1.55 }}>
            {error}
          </p>
          <a
            href="/"
            className="btn-press chamfer"
            style={{
              display: 'inline-block',
              marginTop: 16,
              background: T.accent,
              color: T.paper,
              border: 'none',
              padding: '10px 18px',
              fontSize: 14,
              fontWeight: 600,
              fontFamily: T.sans,
              textDecoration: 'none',
            }}
          >
            Try today's challenge →
          </a>
        </div>
      )}

      {data && <SharedView data={data} />}
    </main>
  );
}

function SharedView({ data }: { data: SharedChallenge }) {
  return (
    <>
      {/* Hero */}
      <header style={{ marginBottom: 28 }}>
        <div
          style={{
            ...kicker(),
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span>MATHIQ DAILY #{data.challengeNumber}</span>
          <span aria-hidden>·</span>
          <DifficultyChip tier={data.difficulty} />
        </div>
        <h1
          style={{
            fontFamily: T.sans,
            fontSize: 'clamp(28px, 5vw, 40px)',
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
            margin: '8px 0 8px',
          }}
        >
          {data.courseTitle} · {data.topicTitle}
        </h1>
        <p style={{ fontSize: 14, color: T.muted, margin: 0, fontFamily: T.mono, letterSpacing: '0.06em' }}>
          {formatDate(data.date)}
        </p>
      </header>

      {/* The problem */}
      <section
        style={{
          padding: '20px 22px',
          border: `1px solid ${T.ink}`,
          background: T.paper2,
          marginBottom: 18,
        }}
      >
        <div style={kicker()}>THE PROBLEM</div>
        <div
          style={{
            marginTop: 10,
            fontSize: 17,
            lineHeight: 1.55,
            color: T.ink,
          }}
        >
          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
            {data.problemText}
          </ReactMarkdown>
        </div>
      </section>

      {/* Verdict */}
      <section
        style={{
          padding: '20px 22px',
          border: `1px solid ${T.ink}`,
          background: data.grade.correct ? T.paper2 : T.paper,
          marginBottom: data.studentMmd ? 18 : 28,
        }}
      >
        <div style={{ ...kicker(), display: 'flex', alignItems: 'center', gap: 8 }}>
          {data.grade.correct ? (
            <>
              <CheckIcon /> SOLVED
            </>
          ) : (
            <>
              <CrossIcon /> NOT QUITE
            </>
          )}
        </div>
        {data.grade.studentAnswer && (
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
            <span>Their answer:</span>
            <strong>
              <InlineMath value={data.grade.studentAnswer} />
            </strong>
          </div>
        )}
        {data.grade.feedback && (
          <p style={{ marginTop: 6, fontSize: 14, color: T.muted, lineHeight: 1.55 }}>
            {data.grade.feedback}
          </p>
        )}
      </section>

      {/* Their submitted work — rendered inline via KaTeX from the MMD the
       *  student sent in (typed or OCR'd from a photo). No PDF round-trip;
       *  the same renderer used for the problem above handles math here. */}
      {data.studentMmd && (
        <section style={{ marginBottom: 28 }}>
          <div style={{ ...kicker(), marginBottom: 8 }}>THEIR WORK</div>
          <div
            style={{
              padding: '20px 22px',
              border: `1px solid ${T.ink}`,
              background: '#fff',
              fontSize: 16,
              lineHeight: 1.6,
              color: T.ink,
              overflowX: 'auto',
            }}
          >
            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
              {data.studentMmd}
            </ReactMarkdown>
          </div>
        </section>
      )}

      {/* Footer CTA */}
      <section
        style={{
          padding: '24px 22px',
          border: `1px solid ${T.ink}`,
          background: T.paper,
          textAlign: 'center',
        }}
      >
        <div style={kicker()}>YOUR TURN</div>
        <p
          style={{
            marginTop: 10,
            fontSize: 16,
            color: T.ink,
            lineHeight: 1.5,
          }}
        >
          Solve today's MathIQ Daily Challenge and share your own typeset solution.
        </p>
        <a
          href="/"
          className="btn-press chamfer"
          style={{
            display: 'inline-block',
            marginTop: 16,
            background: T.accent,
            color: T.paper,
            border: 'none',
            padding: '12px 22px',
            fontSize: 15,
            fontWeight: 600,
            fontFamily: T.sans,
            textDecoration: 'none',
          }}
        >
          Try today's challenge →
        </a>
      </section>
    </>
  );
}

function LoadingState() {
  return (
    <div
      style={{
        padding: '24px 22px',
        border: `1px solid ${T.hair}`,
        background: T.paper2,
        opacity: 0.7,
      }}
    >
      <div style={kicker()}>LOADING…</div>
      <div style={{ height: 28, width: '60%', background: T.hair, marginTop: 14 }} />
      <div style={{ height: 18, width: '90%', background: T.hair, marginTop: 12 }} />
      <div style={{ height: 18, width: '70%', background: T.hair, marginTop: 6 }} />
    </div>
  );
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
