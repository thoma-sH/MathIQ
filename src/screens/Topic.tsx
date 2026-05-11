import { useEffect, useRef, useState } from 'react';
import { SignInButton, useAuth } from '@clerk/clerk-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { T } from '../design/tokens';
import { COURSES_BY_ID } from '../walkthroughs/courses';
import {
  WalkthroughError,
  streamWalkthrough,
  type RateLimitInfo,
} from '../walkthroughs/generate';
import { classifyTopic } from '../walkthroughs/classify';
import type { Route } from '../router';

interface TopicScreenProps {
  courseId: string;
  topicId: string;
  initialProblem?: string;
  onNavigate: (route: Route) => void;
}

type Status =
  | 'idle'
  | 'streaming'
  | 'done'
  | 'error'
  | 'sign-in-required'
  | 'rate-limited';

interface RateLimitDisplay {
  message: string;
  resetAt?: string;
}

export function TopicScreen({
  courseId,
  topicId,
  initialProblem,
  onNavigate,
}: TopicScreenProps) {
  const course = COURSES_BY_ID[courseId];
  const topic = course?.topics.find((t) => t.id === topicId);
  const { getToken, isSignedIn } = useAuth();

  const [output, setOutput] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rateInfo, setRateInfo] = useState<RateLimitInfo | null>(null);
  const [limitDetail, setLimitDetail] = useState<RateLimitDisplay | null>(null);
  const [customProblem, setCustomProblem] = useState(initialProblem ?? '');
  const [classifying, setClassifying] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (initialProblem && course && topic) {
      void runWalkthrough(initialProblem);
    }
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProblem, courseId, topicId]);

  if (!course || !topic) {
    return (
      <main
        className="responsive-pad"
        style={{ maxWidth: 720, margin: '0 auto', paddingTop: 32 }}
      >
        <p style={{ fontSize: 14, color: T.muted, marginBottom: 16 }}>
          That topic doesn't exist.
        </p>
        <button
          onClick={() => onNavigate({ name: 'home' })}
          className="btn-press chamfer"
          style={cta()}
        >
          ← Back home
        </button>
      </main>
    );
  }

  async function runWalkthrough(problem?: string) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('streaming');
    setOutput('');
    setErrorMsg(null);
    setLimitDetail(null);

    try {
      for await (const chunk of streamWalkthrough({
        course: course!,
        topic: topic!,
        problem,
        signal: controller.signal,
        getToken,
        onRateLimitInfo: setRateInfo,
      })) {
        setOutput((prev) => prev + chunk);
      }
      setStatus('done');
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof WalkthroughError) {
        if (err.kind === 'sign_in_required') {
          setStatus('sign-in-required');
          setLimitDetail({ message: err.message });
          return;
        }
        if (err.kind === 'rate_limit') {
          setStatus('rate-limited');
          setLimitDetail({
            message: err.message,
            resetAt: err.data?.resetAt,
          });
          return;
        }
      }
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  async function submitCustomProblem() {
    const trimmed = customProblem.trim();
    if (!trimmed) return;

    setClassifying(true);
    try {
      const match = await classifyTopic({
        problem: trimmed,
        getToken,
      });
      if (
        match &&
        (match.courseId !== course!.id || match.topicId !== topic!.id)
      ) {
        onNavigate({
          name: 'topic',
          courseId: match.courseId,
          topicId: match.topicId,
          problem: trimmed,
        });
        return;
      }
    } catch {
      // Classification failure is non-fatal
    } finally {
      setClassifying(false);
    }
    void runWalkthrough(trimmed);
  }

  const otherTopics = course.topics.filter((t) => t.id !== topic.id).slice(0, 4);

  return (
    <main
      className="responsive-pad"
      style={{
        maxWidth: 720,
        margin: '0 auto',
        paddingTop: 24,
        paddingBottom: 96,
      }}
    >
      <button
        onClick={() => onNavigate({ name: 'walkthrough', courseId: course.id })}
        className="btn-press"
        style={breadcrumb()}
      >
        ← {course.title}
      </button>

      <h1
        className="reveal reveal-1"
        style={{
          fontFamily: T.sans,
          fontSize: 'clamp(28px, 6vw, 38px)',
          fontWeight: 700,
          lineHeight: 1.05,
          letterSpacing: '-0.02em',
          margin: '0 0 16px',
        }}
      >
        {topic.title}
      </h1>

      <section
        className="reveal reveal-2"
        style={{
          padding: '18px 20px',
          border: `1px solid ${T.ink}`,
          background: T.paper2,
          marginBottom: 24,
        }}
      >
        <div style={kicker()}>STRATEGIC ANCHOR</div>
        <div
          className="markdown-body"
          style={{ fontSize: 15, lineHeight: 1.55 }}
        >
          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
            {topic.strategicAnchor}
          </ReactMarkdown>
        </div>
      </section>

      <section className="reveal reveal-3" style={{ marginBottom: 20 }}>
        <div style={kicker(8)}>EXAMPLE PROBLEM</div>
        <div
          style={{
            border: `1px solid ${T.ink}`,
            background: T.paper,
            padding: '20px 22px',
            fontSize: 18,
            overflowX: 'auto',
          }}
        >
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
              {topic.exampleProblem}
            </ReactMarkdown>
          </div>
        </div>
      </section>

      {status === 'idle' && (
        <button
          onClick={() => runWalkthrough()}
          className="btn-press chamfer reveal reveal-4"
          style={primaryCta()}
        >
          Walk me through it →
        </button>
      )}

      {status === 'streaming' && (
        <div
          style={{
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <span style={kicker(0)}>IRIS IS STREAMING…</span>
          <button
            onClick={() => {
              abortRef.current?.abort();
              setStatus('done');
            }}
            className="btn-press"
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              fontSize: 12,
              color: T.muted,
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            stop
          </button>
        </div>
      )}

      {rateInfo && (status === 'streaming' || status === 'done') && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <UsagePill rate={rateInfo} signedIn={!!isSignedIn} />
          {rateInfo.modelUsed && (
            <span
              style={{
                fontFamily: T.mono,
                fontSize: 11,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: T.muted,
              }}
            >
              · {modelLabel(rateInfo.modelUsed)}
            </span>
          )}
        </div>
      )}

      {rateInfo?.degraded && rateInfo.tier === 'pro' && (status === 'streaming' || status === 'done') && (
        <div
          style={{
            border: `1px solid ${T.ink}`,
            background: T.paper2,
            padding: '12px 16px',
            marginBottom: 12,
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          <strong>You've used your {rateInfo.premiumAllotment ?? 20} Opus walkthroughs today.</strong>{' '}
          Now on Sonnet 4.6 for the rest of today — still strong, just not the top of the stack.
        </div>
      )}

      {status === 'sign-in-required' && (
        <div style={errorBox()}>
          <div style={kicker()}>FREE WALKTHROUGH USED</div>
          <p style={{ margin: '6px 0 12px', fontSize: 14, lineHeight: 1.5 }}>
            {limitDetail?.message ??
              "You've used your free walkthrough today. Sign in to get 5/day."}
          </p>
          <SignInButton mode="modal">
            <button className="btn-press chamfer" style={primaryCta()}>
              Sign in to continue
            </button>
          </SignInButton>
        </div>
      )}

      {status === 'rate-limited' && (
        <div style={errorBox()}>
          <div style={kicker()}>DAILY LIMIT REACHED</div>
          <p style={{ margin: '6px 0 12px', fontSize: 14, lineHeight: 1.5 }}>
            {limitDetail?.message ?? "You've used today's walkthroughs."}{' '}
            {limitDetail?.resetAt && (
              <span style={{ color: T.muted }}>
                Resets {formatReset(limitDetail.resetAt)}.
              </span>
            )}
          </p>
          <p style={{ margin: '6px 0 12px', fontSize: 13, color: T.muted, lineHeight: 1.5 }}>
            Pro upgrade with higher limits and the premium model is coming soon.
          </p>
        </div>
      )}

      {status === 'error' && errorMsg && (
        <div style={errorBox()}>
          <div style={kicker()}>SOMETHING WENT WRONG</div>
          <p
            style={{
              margin: '6px 0 12px',
              fontSize: 14,
              lineHeight: 1.5,
              fontFamily: T.mono,
            }}
          >
            {errorMsg}
          </p>
          <button
            onClick={() => runWalkthrough()}
            className="btn-press chamfer"
            style={cta()}
          >
            Try again
          </button>
        </div>
      )}

      {output && (
        <article
          className="markdown-body"
          style={{
            marginTop: 16,
            padding: '20px 22px',
            border: `1px solid ${T.ink}`,
            background: T.paper,
            fontSize: 15,
            lineHeight: 1.6,
          }}
        >
          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
            {output}
          </ReactMarkdown>
        </article>
      )}

      <hr
        style={{
          margin: '40px 0 24px',
          border: 'none',
          borderTop: `1px solid ${T.hair}`,
        }}
      />

      <section>
        <div style={kicker(8)}>TRY YOUR OWN PROBLEM</div>
        <textarea
          value={customProblem}
          onChange={(e) => setCustomProblem(e.target.value)}
          placeholder={`Paste a ${topic.title.toLowerCase()} problem (or anything from ${course.title} — Iris will route).`}
          rows={3}
          style={{
            width: '100%',
            border: `1px solid ${T.ink}`,
            background: T.paper,
            padding: '12px 14px',
            fontSize: 15,
            fontFamily: T.mono,
            resize: 'vertical',
            color: T.ink,
            outline: 'none',
          }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginTop: 10,
          }}
        >
          <button
            onClick={submitCustomProblem}
            disabled={!customProblem.trim() || classifying || status === 'streaming'}
            className="btn-press chamfer"
            style={primaryCta(
              !customProblem.trim() || classifying || status === 'streaming',
            )}
          >
            {classifying ? 'Routing…' : 'Generate →'}
          </button>
          <span style={{ fontSize: 12, color: T.muted, lineHeight: 1.4 }}>
            If your problem fits a different topic, Iris will route you there.
          </span>
        </div>
      </section>

      {otherTopics.length > 0 && (
        <section style={{ marginTop: 48 }}>
          <div style={kicker(10)}>OTHER TOPICS IN {course.title.toUpperCase()}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {otherTopics.map((t) => (
              <button
                key={t.id}
                onClick={() =>
                  onNavigate({ name: 'topic', courseId: course.id, topicId: t.id })
                }
                className="btn-press"
                style={{
                  background: 'transparent',
                  border: `1px solid ${T.hair}`,
                  padding: '14px 16px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontFamily: 'inherit',
                  color: T.ink,
                }}
              >
                <span>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{t.title}</span>
                  <span style={{ fontSize: 13, color: T.muted, marginLeft: 8 }}>
                    {t.blurb}
                  </span>
                </span>
                <span className="arrow-nudge" style={{ color: T.muted }}>
                  →
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function UsagePill({
  rate,
  signedIn,
}: {
  rate: RateLimitInfo;
  signedIn: boolean;
}) {
  const used = rate.limit - rate.remaining;
  const label = signedIn
    ? `${used} of ${rate.limit} today`
    : `${used} of ${rate.limit} free`;
  return (
    <div
      style={{
        display: 'inline-block',
        padding: '4px 10px 5px',
        background: 'transparent',
        border: `1px solid ${T.hairStrong}`,
        fontFamily: T.mono,
        fontSize: 11,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: T.muted,
        marginBottom: 12,
      }}
    >
      {label}
    </div>
  );
}

function modelLabel(id: string): string {
  if (id === 'claude-opus-4-6') return 'OPUS 4.6';
  if (id === 'claude-sonnet-4-6') return 'SONNET 4.6';
  if (id === 'deepseek/deepseek-chat') return 'DEEPSEEK V3';
  return id.toUpperCase();
}

function formatReset(iso: string): string {
  try {
    const reset = new Date(iso);
    const now = new Date();
    const ms = reset.getTime() - now.getTime();
    if (ms <= 0) return 'soon';
    const hours = Math.floor(ms / 3_600_000);
    const minutes = Math.floor((ms % 3_600_000) / 60_000);
    if (hours > 0) return `in ${hours}h ${minutes}m`;
    return `in ${minutes}m`;
  } catch {
    return 'soon';
  }
}

function kicker(mb = 6): React.CSSProperties {
  return {
    fontFamily: T.mono,
    fontSize: 11,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: T.muted,
    marginBottom: mb,
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

function cta(): React.CSSProperties {
  return {
    background: T.ink,
    color: T.paper,
    border: 'none',
    padding: '10px 18px',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: T.sans,
  };
}

function primaryCta(disabled = false): React.CSSProperties {
  return {
    background: disabled ? T.hair : T.accent,
    color: disabled ? T.muted : T.paper,
    border: 'none',
    padding: '12px 20px',
    fontSize: 15,
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: T.sans,
  };
}

function errorBox(): React.CSSProperties {
  return {
    border: `1px solid ${T.ink}`,
    background: T.paper2,
    padding: '16px 18px',
    marginTop: 12,
  };
}
