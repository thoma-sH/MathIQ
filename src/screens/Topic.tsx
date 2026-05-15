import { useEffect, useMemo, useRef, useState } from 'react';
import { SignInButton, useAuth } from '@clerk/clerk-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { T } from '../design/tokens';
import { COURSES_BY_ID } from '../walkthroughs/courses';
import {
  WalkthroughError,
  streamWalkthrough,
  type RateLimitInfo,
} from '../walkthroughs/generate';
import { classifyTopic } from '../walkthroughs/classify';
import { looksLikeProblem } from '../walkthroughs/isProblem';
import { saveHistoryRecord } from '../walkthroughs/history';
import { extractProblemFromImage, OcrError } from '../walkthroughs/ocr';
import { verifyWalkthrough, type Verdict } from '../walkthroughs/verify';
import { getPromptFlow, type PromptFlow } from '../state/promptFlow';
import { useUpgradePrompt } from '../upgrade/UpgradePrompt';
import { openScanner } from '../scanner';
import { NotFound } from './NotFound';
import type { Route } from '../router';

interface TopicScreenProps {
  courseId: string;
  topicId: string;
  initialProblem?: string;
  onNavigate: (route: Route) => void;
}

type LimitStatus = 'sign-in-required' | 'rate-limited' | 'error' | null;

interface RateLimitDisplay {
  message: string;
  resetAt?: string;
}

type StreamTarget =
  | null
  | 'walkthrough'
  | { kind: 'why-how'; index: number };

// Step markers vary by model drift. Match any of these line-starts:
//   `**Step 1.**`, `**Step 1:**`, `**Step 1**`        — bold form (preferred)
//   `**Step 1: Identify u and dv**`                    — bold spanning whole heading
//   `### Step 1`, `## Step 1:`                          — markdown heading form
//   `Step 1:` / `Step 1.` at the start of a line       — bare form
// Anchored to start-of-line (multi-line flag) so a "Step 3" mentioned in
// body prose never splits the stream.
const STEP_MARKER = /^\s*(?:\*\*\s*Step\s+\d+|#{1,6}\s+Step\s+\d+|Step\s+\d+\s*[:.])/gim;

interface ParsedStream {
  /** Text before the first `**Step N**` marker. Practice mode opens with
   *  `*Practice problem.* <statement>` here. Null if empty. */
  preamble: string | null;
  /** Segments where the *next* marker has arrived, or stream is done. */
  complete: string[];
  /** Currently-arriving last segment, while streaming. Null when done or no markers seen. */
  streamingTail: string | null;
}

function parseStream(buffer: string, done: boolean): ParsedStream {
  if (!buffer.trim()) {
    return { preamble: null, complete: [], streamingTail: null };
  }
  const positions: number[] = [];
  STEP_MARKER.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STEP_MARKER.exec(buffer)) !== null) positions.push(m.index);
  if (positions.length === 0) {
    // No step markers yet. While streaming, show buffer as preamble so the
    // practice problem statement renders as it arrives; on done with no
    // markers at all, treat the whole thing as a single complete segment.
    return done
      ? { preamble: null, complete: [buffer.trim()], streamingTail: null }
      : { preamble: buffer.trim() || null, complete: [], streamingTail: null };
  }
  const preamble = buffer.slice(0, positions[0]).trim() || null;
  const complete: string[] = [];
  for (let i = 0; i < positions.length - 1; i++) {
    complete.push(buffer.slice(positions[i], positions[i + 1]).trim());
  }
  const tail = buffer.slice(positions[positions.length - 1]).trim();
  if (done) {
    complete.push(tail);
    return { preamble, complete, streamingTail: null };
  }
  return { preamble, complete, streamingTail: tail };
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
  const { requireUpgrade } = useUpgradePrompt();

  const [buffer, setBuffer] = useState('');
  const [streamDone, setStreamDone] = useState(false);
  const [sessionMode, setSessionMode] = useState<PromptFlow>('step');
  const [revealCount, setRevealCount] = useState(0);
  const [problemForSession, setProblemForSession] = useState<string | undefined>();
  const [streaming, setStreaming] = useState<StreamTarget>(null);

  const [whyHow, setWhyHow] = useState<Record<number, string>>({});
  const [whyHowStream, setWhyHowStream] = useState<{ index: number; text: string } | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const [limitStatus, setLimitStatus] = useState<LimitStatus>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rateInfo, setRateInfo] = useState<RateLimitInfo | null>(null);
  const [limitDetail, setLimitDetail] = useState<RateLimitDisplay | null>(null);
  const [customProblem, setCustomProblem] = useState(initialProblem ?? '');
  const [classifying, setClassifying] = useState(false);
  const [submitHint, setSubmitHint] = useState<string | null>(null);
  const walkthroughAbortRef = useRef<AbortController | null>(null);
  const whyHowAbortRef = useRef<AbortController | null>(null);
  const classifyAbortRef = useRef<AbortController | null>(null);
  const [ocrState, setOcrState] = useState<'idle' | 'reading' | 'error'>('idle');
  const [ocrMessage, setOcrMessage] = useState<string | null>(null);

  const verifyAbortRef = useRef<AbortController | null>(null);
  const [verifyState, setVerifyState] = useState<'idle' | 'verifying' | Verdict>('idle');
  const [verifyReason, setVerifyReason] = useState<string | null>(null);

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  const parsed = useMemo(() => parseStream(buffer, streamDone), [buffer, streamDone]);

  // Auto-reveal the first segment as soon as it lands.
  useEffect(() => {
    if (revealCount === 0 && parsed.complete.length > 0) {
      setRevealCount(1);
    }
  }, [parsed.complete.length, revealCount]);

  useEffect(() => {
    if (initialProblem && course && topic) {
      void runWalkthrough(initialProblem);
    }
    return () => {
      walkthroughAbortRef.current?.abort();
      whyHowAbortRef.current?.abort();
      classifyAbortRef.current?.abort();
      verifyAbortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProblem, courseId, topicId]);

  if (!course || !topic) {
    return (
      <NotFound
        message="That topic doesn't exist — it may have been renamed or removed."
        onNavigate={onNavigate}
      />
    );
  }

  function resetSession() {
    walkthroughAbortRef.current?.abort();
    whyHowAbortRef.current?.abort();
    verifyAbortRef.current?.abort();
    setVerifyState('idle');
    setVerifyReason(null);
    setSaveState('idle');
    setBuffer('');
    setStreamDone(false);
    setRevealCount(0);
    setWhyHow({});
    setWhyHowStream(null);
    setExpanded({});
    setLimitStatus(null);
    setErrorMsg(null);
    setLimitDetail(null);
  }

  async function runWalkthrough(problem?: string, opts?: { practice?: boolean }) {
    resetSession();
    const mode = getPromptFlow();
    setSessionMode(mode);
    setProblemForSession(problem);

    walkthroughAbortRef.current?.abort();
    const controller = new AbortController();
    walkthroughAbortRef.current = controller;
    setStreaming('walkthrough');

    const action = opts?.practice ? 'practice' : 'walkthrough';
    let accumulated = '';
    try {
      for await (const chunk of streamWalkthrough({
        course: course!,
        topic: topic!,
        problem,
        signal: controller.signal,
        getToken,
        onRateLimitInfo: setRateInfo,
        action,
      })) {
        accumulated += chunk;
        setBuffer(accumulated);
      }
      setStreamDone(true);
      setStreaming((s) => (s === 'walkthrough' ? null : s));
      if (mode === 'all') {
        // Reveal everything immediately.
        const { complete } = parseStream(accumulated, true);
        setRevealCount(complete.length);
      }
      // Fire verification in the background if the walkthrough actually
      // produced an answer. Non-blocking; we render the badge when it lands.
      if (/\*\*Answer:\*\*/i.test(accumulated)) {
        void runVerify(accumulated);
      }
      // Auto-save to history for signed-in users. Surface the save state so
      // the user can see it land (and notice if it ever fails silently).
      if (isSignedIn && accumulated.trim()) {
        setSaveState('saving');
        void (async () => {
          const result = await saveHistoryRecord({
            getToken,
            courseId: course!.id,
            topicId: topic!.id,
            problem: opts?.practice ? null : problem ?? null,
            walkthrough: accumulated,
            modelUsed: rateInfo?.modelUsed ?? null,
          });
          setSaveState(result ? 'saved' : 'failed');
        })();
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setStreaming((s) => (s === 'walkthrough' ? null : s));
      handleStreamError(err);
    }
  }

  async function requestWhyHow(index: number) {
    setExpanded((p) => ({ ...p, [index]: true }));
    if (whyHow[index] !== undefined) return;

    // Abort only any prior why-how stream — leave the walkthrough alone.
    whyHowAbortRef.current?.abort();
    const controller = new AbortController();
    whyHowAbortRef.current = controller;
    setStreaming({ kind: 'why-how', index });
    setWhyHowStream({ index, text: '' });

    // Send the walkthrough text up to and including the target step.
    // Prepend the preamble so practice-mode why-how sees the problem statement.
    const steps = parsed.complete.slice(0, index + 1).join('\n\n');
    const cumulative = parsed.preamble ? `${parsed.preamble}\n\n${steps}` : steps;

    let accumulated = '';
    try {
      for await (const chunk of streamWalkthrough({
        course: course!,
        topic: topic!,
        problem: problemForSession,
        signal: controller.signal,
        getToken,
        onRateLimitInfo: setRateInfo,
        action: 'why-how',
        walkthroughSoFar: cumulative,
      })) {
        accumulated += chunk;
        setWhyHowStream({ index, text: accumulated });
      }
      setWhyHow((p) => ({ ...p, [index]: accumulated }));
      setWhyHowStream(null);
      setStreaming((s) =>
        s && typeof s === 'object' && s.kind === 'why-how' && s.index === index ? null : s,
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      setWhyHowStream(null);
      setStreaming((s) =>
        s && typeof s === 'object' && s.kind === 'why-how' && s.index === index ? null : s,
      );
      handleStreamError(err);
    }
  }

  function handleStreamError(err: unknown) {
    if (err instanceof WalkthroughError) {
      if (err.kind === 'sign_in_required') {
        setLimitStatus('sign-in-required');
        setLimitDetail({ message: err.message });
        return;
      }
      if (err.kind === 'rate_limit') {
        setLimitStatus('rate-limited');
        setLimitDetail({ message: err.message, resetAt: err.data?.resetAt });
        return;
      }
    }
    setLimitStatus('error');
    setErrorMsg(err instanceof Error ? err.message : 'Unknown error');
  }

  async function runVerify(walkthroughText: string) {
    verifyAbortRef.current?.abort();
    const controller = new AbortController();
    verifyAbortRef.current = controller;
    setVerifyState('verifying');
    setVerifyReason(null);
    try {
      const res = await verifyWalkthrough({ walkthrough: walkthroughText, getToken, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!res) {
        // Network/upstream failure — fail open quietly; no badge instead of a false "correct".
        setVerifyState('idle');
        return;
      }
      setVerifyState(res.verdict);
      setVerifyReason(res.reason);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setVerifyState('idle');
    }
  }

  async function handleImageFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setOcrState('error');
      setOcrMessage('Pick an image file (JPG, PNG, or WebP).');
      return;
    }
    setOcrState('reading');
    setOcrMessage(null);
    try {
      const text = await extractProblemFromImage({ getToken, file });
      setCustomProblem(text);
      setOcrState('idle');
      setSubmitHint(null);
    } catch (err) {
      setOcrState('error');
      if (err instanceof OcrError) setOcrMessage(err.message);
      else setOcrMessage('Image processing failed — try again.');
    }
  }

  async function attemptPhotoInput() {
    const out = await openScanner({ mode: 'single', output: 'image' });
    if (out && out.kind === 'image') {
      void handleImageFile(out.file);
    }
  }

  async function onImageButtonClick() {
    // Photo input is Plus+. Free users get a small lifetime trial — if
    // they have one available, the upgrade modal exposes a "Try free"
    // button that invokes attemptPhotoInput directly.
    if (rateInfo && rateInfo.tier !== 'plus' && rateInfo.tier !== 'pro') {
      requireUpgrade('photo-input', { onTryFree: () => void attemptPhotoInput() });
      return;
    }
    void attemptPhotoInput();
  }

  function onCustomTextareaPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          void handleImageFile(file);
          return;
        }
      }
    }
  }

  async function submitCustomProblem() {
    const trimmed = customProblem.trim();
    if (!trimmed) return;
    // Already classifying — bail to avoid duplicate in-flight requests.
    if (classifying) return;

    const isProblem = looksLikeProblem(trimmed);
    setSubmitHint(null);

    // Abort any previous classify in case it's still pending.
    classifyAbortRef.current?.abort();
    const controller = new AbortController();
    classifyAbortRef.current = controller;

    setClassifying(true);
    let match: Awaited<ReturnType<typeof classifyTopic>> = null;
    try {
      match = await classifyTopic({ problem: trimmed, getToken, signal: controller.signal });
    } catch (err) {
      // Aborted: a newer submit superseded this one; drop the result silently.
      if (err instanceof Error && err.name === 'AbortError') return;
      // Other failures non-fatal; treat as no-match.
    } finally {
      // Only the controller that actually finished should clear the ref.
      if (classifyAbortRef.current === controller) classifyAbortRef.current = null;
      setClassifying(false);
    }

    // Cross-course / cross-topic match → navigate.
    if (
      match &&
      (match.courseId !== course!.id || match.topicId !== topic!.id)
    ) {
      onNavigate({
        name: 'topic',
        courseId: match.courseId,
        topicId: match.topicId,
        problem: isProblem ? trimmed : undefined,
      });
      return;
    }

    // No usable match (or matched this same topic).
    // If the input looks like a real problem and matched this topic, run it.
    if (isProblem && match) {
      void runWalkthrough(trimmed);
      return;
    }

    // Couldn't place the input — surface a message instead of silently clearing.
    setSubmitHint(
      isProblem
        ? "Couldn't quite place that one — try adding more context, or open one of the topics below."
        : "Couldn't quite place that one — be more specific. Try a full problem like “factor x² + 5x + 6” or “find dy/dx for y = sin(x²)”.",
    );
  }

  const otherTopics = course.topics.filter((t) => t.id !== topic.id).slice(0, 4);
  const hasOutput =
    parsed.preamble !== null ||
    parsed.complete.length > 0 ||
    parsed.streamingTail !== null;
  const isStreamingWalkthrough = streaming === 'walkthrough';
  const isStreamingAnything = streaming !== null;

  // In step mode, only show segments up to revealCount.
  const visibleSteps =
    sessionMode === 'all'
      ? parsed.complete
      : parsed.complete.slice(0, revealCount);

  const isPaid = rateInfo?.tier === 'plus' || rateInfo?.tier === 'pro';

  const finalAnswered = useMemo(
    () => streamDone && /\*\*Answer:\*\*/i.test(buffer),
    [streamDone, buffer],
  );

  const canRevealMore =
    sessionMode === 'step' && revealCount < parsed.complete.length;
  const moreIncoming =
    sessionMode === 'step' &&
    revealCount === parsed.complete.length &&
    !streamDone &&
    isStreamingWalkthrough;
  const walkthroughFinished =
    streamDone &&
    (sessionMode === 'all' || revealCount >= parsed.complete.length);

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
        <div className="markdown-body" style={{ fontSize: 15, lineHeight: 1.55 }}>
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

      {!hasOutput && !limitStatus && !isStreamingAnything && (
        <div className="reveal reveal-4" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => runWalkthrough()}
            className="btn-press chamfer"
            style={primaryCta()}
          >
            Walk me through it →
          </button>
          <button
            onClick={() => runWalkthrough(undefined, { practice: true })}
            className="btn-press chamfer"
            aria-label="Generate a new practice problem for this topic"
            style={{
              background: 'transparent',
              color: T.ink,
              border: `1px solid ${T.ink}`,
              padding: '12px 20px',
              fontSize: 15,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: T.sans,
            }}
          >
            Practice problem →
          </button>
        </div>
      )}

      {isStreamingAnything && (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <span style={kicker(0)}>
            {isStreamingWalkthrough ? 'IRIS IS STREAMING…' : 'WHY & HOW STREAMING…'}
          </span>
          <button
            onClick={() => {
              walkthroughAbortRef.current?.abort();
              whyHowAbortRef.current?.abort();
              setStreaming(null);
              setWhyHowStream(null);
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

      {rateInfo && (hasOutput || isStreamingAnything) && (
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

      {rateInfo?.degraded && rateInfo.tier === 'plus' && (hasOutput || isStreamingAnything) && (
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

      {limitStatus === 'sign-in-required' && (
        <div style={errorBox()}>
          <div style={kicker()}>FREE WALKTHROUGH USED</div>
          <p style={{ margin: '6px 0 12px', fontSize: 14, lineHeight: 1.5 }}>
            {limitDetail?.message ??
              "You've used your free walkthrough today. Sign in to get 3/day."}
          </p>
          <SignInButton mode="modal">
            <button className="btn-press chamfer" style={primaryCta()}>
              Sign in to continue
            </button>
          </SignInButton>
        </div>
      )}

      {limitStatus === 'rate-limited' && (
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

      {limitStatus === 'error' && errorMsg && (
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
            onClick={() => runWalkthrough(problemForSession)}
            className="btn-press chamfer"
            style={cta()}
          >
            Try again
          </button>
        </div>
      )}

      {parsed.preamble && /^\*Practice problem\.?\*/i.test(parsed.preamble) && (
        <section
          style={{
            border: `1px solid ${T.ink}`,
            background: T.paper,
            padding: '18px 22px',
            marginBottom: 16,
            fontSize: 16,
            lineHeight: 1.55,
            overflowX: 'auto',
          }}
        >
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
              {parsed.preamble}
            </ReactMarkdown>
          </div>
        </section>
      )}

      {visibleSteps.map((stepText, i) => (
        <StepCard
          key={i}
          index={i}
          text={stepText}
          showWhyHow={true}
          whyHowText={whyHow[i]}
          whyHowExpanded={!!expanded[i]}
          whyHowStreaming={whyHowStream?.index === i ? whyHowStream.text : null}
          onToggleWhyHow={() => {
            if (!isPaid) {
              // Free users get 5 lifetime why-how trials. The modal lets
              // them spend one directly via the Try-free button.
              requireUpgrade('why-how', { onTryFree: () => void requestWhyHow(i) });
              return;
            }
            if (whyHow[i] !== undefined) {
              setExpanded((p) => ({ ...p, [i]: !p[i] }));
              return;
            }
            void requestWhyHow(i);
          }}
          disabledWhyHow={isStreamingAnything}
        />
      ))}

      {/* In 'all' mode, show the streaming tail inline as it arrives. */}
      {sessionMode === 'all' && parsed.streamingTail && (
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
            {parsed.streamingTail}
          </ReactMarkdown>
        </article>
      )}

      {canRevealMore && (
        <button
          onClick={() => setRevealCount((n) => n + 1)}
          className="btn-press chamfer"
          style={{ ...primaryCta(), marginTop: 16 }}
        >
          Next step →
        </button>
      )}

      {moreIncoming && (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginTop: 16,
            fontSize: 13,
            color: T.muted,
            fontFamily: T.mono,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          … preparing next step
        </div>
      )}

      {isStreamingWalkthrough && !streamDone && !moreIncoming && visibleSteps.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginTop: 16,
            fontSize: 13,
            color: T.muted,
            fontFamily: T.mono,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          … iris is still writing
        </div>
      )}

      {walkthroughFinished && (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginTop: 16,
            fontSize: 12,
            color: T.muted,
            fontFamily: T.mono,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}
        >
          {finalAnswered
            ? 'Walkthrough complete'
            : parsed.complete.length === 1
              ? 'No further steps were generated'
              : 'Walkthrough finished'}
        </div>
      )}

      {verifyState !== 'idle' && (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginTop: 10,
            padding: verifyState === 'incorrect' ? '8px 12px' : 0,
            border: verifyState === 'incorrect' ? `1px solid ${T.ink}` : 'none',
            background: verifyState === 'incorrect' ? T.paper2 : 'transparent',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontFamily: T.mono,
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color:
              verifyState === 'correct' ? T.accent3 :
              verifyState === 'incorrect' ? T.ink :
              T.muted,
          }}
        >
          <span aria-hidden style={{ fontSize: 13 }}>
            {verifyState === 'verifying' ? '·' :
             verifyState === 'correct'   ? '✓' :
             verifyState === 'incorrect' ? '!' :
             '?'}
          </span>
          {verifyState === 'verifying' ? 'Checking the answer…' :
           verifyState === 'correct'   ? 'Answer verified' :
           verifyState === 'incorrect' ? (verifyReason ? `Possible issue: ${verifyReason}` : 'Possible issue — double-check this') :
           'Couldn’t verify automatically'}
        </div>
      )}

      {verifyState === 'incorrect' && rateInfo && !isPaid && (
        <div
          style={{
            marginTop: 8,
            padding: '8px 12px',
            border: `1px solid ${T.hair}`,
            background: 'transparent',
            fontFamily: T.mono,
            fontSize: 11,
            letterSpacing: '0.1em',
            lineHeight: 1.5,
            color: T.muted,
          }}
        >
          MathIQ+ runs Opus 4.6 and Sonnet 4.6 — far fewer errors on problems like this.{' '}
          <button
            type="button"
            onClick={() => onNavigate({ name: 'settings' })}
            className="btn-press"
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              fontFamily: T.mono,
              fontSize: 11,
              letterSpacing: '0.1em',
              color: T.accent,
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
          >
            Upgrade →
          </button>
        </div>
      )}

      {saveState !== 'idle' && (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginTop: 6,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: T.mono,
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: saveState === 'failed' ? T.ink : T.muted,
            marginLeft: verifyState !== 'idle' ? 12 : 0,
          }}
        >
          <span aria-hidden style={{ fontSize: 13 }}>
            {saveState === 'saving' ? '·' : saveState === 'saved' ? '✓' : '!'}
          </span>
          {saveState === 'saving' ? 'Saving to history…' :
           saveState === 'saved'  ? 'Saved to history' :
           'History save failed'}
        </div>
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
          onChange={(e) => {
            setCustomProblem(e.target.value);
            if (submitHint) setSubmitHint(null);
          }}
          onPaste={onCustomTextareaPaste}
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
            disabled={!customProblem.trim() || classifying || isStreamingAnything}
            className="btn-press chamfer"
            style={primaryCta(
              !customProblem.trim() || classifying || isStreamingAnything,
            )}
          >
            {classifying ? 'Routing…' : 'Generate →'}
          </button>
          <button
            type="button"
            onClick={() => void onImageButtonClick()}
            disabled={ocrState === 'reading' || classifying || isStreamingAnything}
            aria-label="Scan a problem with your camera"
            className="btn-press"
            style={{
              background: 'transparent',
              border: `1px solid ${T.ink}`,
              padding: '10px 14px',
              fontSize: 13,
              fontWeight: 500,
              cursor: ocrState === 'reading' || classifying || isStreamingAnything ? 'not-allowed' : 'pointer',
              fontFamily: T.mono,
              letterSpacing: '0.08em',
              color: T.ink,
            }}
          >
            {ocrState === 'reading' ? 'Reading…' : 'Scan'}
          </button>
          <span style={{ fontSize: 12, color: T.muted, lineHeight: 1.4 }}>
            If your problem fits a different topic, Iris will route you there.
          </span>
        </div>
        {ocrState === 'error' && ocrMessage && (
          <div
            role="status"
            aria-live="polite"
            style={{
              marginTop: 12,
              fontSize: 13,
              color: T.muted,
              fontFamily: T.mono,
            }}
          >
            {ocrMessage}
          </div>
        )}
        {submitHint && (
          <div
            role="status"
            aria-live="polite"
            style={{
              marginTop: 12,
              padding: '10px 14px',
              border: `1px solid ${T.ink}`,
              background: T.paper2,
              fontSize: 13,
              lineHeight: 1.5,
              color: T.ink,
            }}
          >
            {submitHint}
          </div>
        )}
      </section>

      {otherTopics.length > 0 && (
        <section style={{ marginTop: 48 }}>
          <div style={kicker(10)}>OTHER TOPICS IN {course.title.toUpperCase()}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {otherTopics.map((t) => (
              <button
                key={t.id}
                aria-label={`Open ${t.title}`}
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
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{t.title}</span>
                  <span
                    className="markdown-body"
                    style={{
                      fontSize: 13,
                      color: T.muted,
                      marginLeft: 8,
                      display: 'inline',
                    }}
                  >
                    <ReactMarkdown
                      remarkPlugins={[remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                      components={{ p: ({ children }) => <>{children}</> }}
                    >
                      {t.blurb}
                    </ReactMarkdown>
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

function StepCard({
  index,
  text,
  showWhyHow,
  whyHowText,
  whyHowExpanded,
  whyHowStreaming,
  onToggleWhyHow,
  disabledWhyHow,
}: {
  index: number;
  text: string;
  showWhyHow: boolean;
  whyHowText: string | undefined;
  whyHowExpanded: boolean;
  whyHowStreaming: string | null;
  onToggleWhyHow: () => void;
  disabledWhyHow: boolean;
}) {
  const liveStreaming = whyHowStreaming !== null;
  const showWhyHowBlock =
    liveStreaming || (whyHowExpanded && whyHowText !== undefined);
  return (
    <article
      style={{
        marginTop: 16,
        border: `1px solid ${T.ink}`,
        background: T.paper,
      }}
    >
      <div
        className="markdown-body"
        style={{
          padding: '20px 22px',
          fontSize: 15,
          lineHeight: 1.6,
        }}
      >
        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
          {text}
        </ReactMarkdown>
      </div>
      {showWhyHow && (
        <div
          style={{
            borderTop: `1px solid ${T.hair}`,
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <button
            onClick={onToggleWhyHow}
            disabled={disabledWhyHow && !liveStreaming}
            className="btn-press"
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              fontSize: 12,
              fontFamily: T.mono,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: disabledWhyHow && !liveStreaming ? T.hairStrong : T.accent,
              cursor: disabledWhyHow && !liveStreaming ? 'not-allowed' : 'pointer',
              textDecoration: 'underline',
            }}
            aria-expanded={showWhyHowBlock}
            aria-controls={`why-how-${index}`}
          >
            {whyHowText !== undefined
              ? whyHowExpanded
                ? 'Hide why & how'
                : 'Show why & how'
              : 'Why & how?'}
          </button>
        </div>
      )}
      {showWhyHowBlock && (
        <div
          id={`why-how-${index}`}
          className="markdown-body"
          style={{
            borderTop: `1px solid ${T.hair}`,
            padding: '16px 22px',
            background: T.paper2,
            fontSize: 14,
            lineHeight: 1.55,
          }}
        >
          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
            {liveStreaming ? whyHowStreaming! : whyHowText!}
          </ReactMarkdown>
        </div>
      )}
    </article>
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
  if (id === 'claude-haiku-4-5') return 'HAIKU 4.5';
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
