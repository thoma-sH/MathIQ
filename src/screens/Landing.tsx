import { useEffect, useMemo, useRef, useState } from 'react';
import { SignedOut, useAuth, useUser } from '@clerk/clerk-react';
import { T } from '../design/tokens';
import { getDailyContent } from '../state/dailyScribe';
import { useTypedString } from '../state/useTypedString';
import { classifyTopic } from '../walkthroughs/classify';
import { looksLikeProblem } from '../walkthroughs/isProblem';
import { extractProblemFromImage, OcrError } from '../walkthroughs/ocr';
import { fetchSubscriptionState, type Tier } from '../billing/client';
import type { TodaysChallenge } from '../billing/challenge';
import { isPaid } from '../walkthroughs/tier';
import { useUpgradePrompt } from '../upgrade/UpgradePrompt';
import { openScanner } from '../scanner';
import { DailyChallengeCard } from '../components/DailyChallengeCard';
import { ChallengeGradeFlow } from '../components/ChallengeGradeFlow';
import type { Route } from '../router';

interface LandingProps {
  onNavigate: (route: Route) => void;
}

type SearchState = 'idle' | 'expanded' | 'classifying' | 'no_match';

function getTimeGreeting(hour: number): string {
  if (hour < 5) return 'Up late';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 22) return 'Good evening';
  return 'Good night';
}

export function Landing({ onNavigate }: LandingProps) {
  const { getToken } = useAuth();
  const { user } = useUser();
  const { dayLabel, scribeSrc } = useMemo(() => getDailyContent(), []);
  const typedLabel = useTypedString(dayLabel, 40, 220);

  const personalGreeting = useMemo(() => {
    const firstName = user?.firstName?.trim();
    if (!firstName) return null;
    return `${getTimeGreeting(new Date().getHours())}, ${firstName}.`;
  }, [user?.firstName]);

  const [searchState, setSearchState] = useState<SearchState>('idle');
  const [problem, setProblem] = useState('');
  const [ocrState, setOcrState] = useState<'idle' | 'reading' | 'error'>('idle');
  const [ocrMessage, setOcrMessage] = useState<string | null>(null);
  const [tier, setTier] = useState<Tier | null>(null);
  const [activeChallenge, setActiveChallenge] = useState<TodaysChallenge | null>(null);
  const { requireUpgrade } = useUpgradePrompt();

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

  function onHomeworkClick() {
    if (!isPaid(tier)) {
      requireUpgrade('homework-plain');
      return;
    }
    onNavigate({ name: 'homework' });
  }
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const scribeTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (searchState === 'expanded' || searchState === 'no_match') {
      // Wait for the scribe-out / search-in cross-fade before focusing.
      const t = window.setTimeout(() => textareaRef.current?.focus(), 240);
      return () => window.clearTimeout(t);
    }
  }, [searchState]);

  // Click outside the stage to collapse — only when textarea is empty.
  useEffect(() => {
    if (searchState !== 'expanded' && searchState !== 'no_match') return;
    const onClick = (e: MouseEvent) => {
      if (!stageRef.current) return;
      if (stageRef.current.contains(e.target as Node)) return;
      if (!problem.trim()) collapseToScribe();
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [searchState, problem]);

  async function submit() {
    const trimmed = problem.trim();
    if (!trimmed) return;
    setSearchState('classifying');
    try {
      const match = await classifyTopic({ problem: trimmed, getToken });
      if (match) {
        // If the input is just a topic name (no math signals), land on the
        // topic page without a problem so the user can use the example
        // intentionally. Otherwise auto-fire the walkthrough on arrival.
        const problem = looksLikeProblem(trimmed) ? trimmed : undefined;
        onNavigate({
          name: 'topic',
          courseId: match.courseId,
          topicId: match.topicId,
          problem,
        });
        return;
      }
      setSearchState('no_match');
    } catch {
      setSearchState('no_match');
    }
  }

  function collapseToScribe() {
    setSearchState('idle');
    setOcrState('idle');
    setOcrMessage(null);
    // Return focus to the trigger so keyboard users land where they started.
    // Use rAF so the scribe is rendered + focusable before we focus it.
    requestAnimationFrame(() => scribeTriggerRef.current?.focus());
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
      setProblem(text);
      setOcrState('idle');
      setOcrMessage(null);
      // Focus the textarea so the user can edit before submitting.
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (err) {
      setOcrState('error');
      if (err instanceof OcrError) setOcrMessage(err.message);
      else setOcrMessage('Image processing failed — try again.');
    }
  }

  async function onScanClick() {
    const out = await openScanner({ mode: 'single', output: 'image' });
    if (out && out.kind === 'image') {
      void handleImageFile(out.file);
    }
  }

  function onTextareaPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
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

  function onTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!problem.trim()) collapseToScribe();
      else textareaRef.current?.blur();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  const expanded = searchState !== 'idle';
  const busy = searchState === 'classifying';

  return (
    <main
      className="responsive-pad"
      style={{
        maxWidth: 760,
        margin: '0 auto',
        paddingTop: 'clamp(56px, 12vh, 140px)',
        paddingBottom: 96,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
      }}
    >
      {/* Personal greeting — only for signed-in users with a first name */}
      {personalGreeting && (
        <p
          className="reveal reveal-1"
          style={{
            fontFamily: T.sans,
            fontSize: 'clamp(18px, 2.8vw, 22px)',
            fontWeight: 500,
            color: T.ink,
            letterSpacing: '-0.01em',
            margin: '0 0 14px',
            opacity: 0.92,
          }}
        >
          {personalGreeting}
        </p>
      )}

      {/* Day kicker */}
      <div
        className={personalGreeting ? 'reveal reveal-2' : 'reveal reveal-1'}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          marginBottom: 'clamp(40px, 8vh, 72px)',
        }}
      >
        <span aria-hidden style={{ width: 'clamp(40px, 8vw, 80px)', height: 1, background: T.ink }} />
        <span
          style={{
            fontFamily: T.mono,
            fontSize: 11,
            letterSpacing: '0.24em',
            color: T.ink,
            textTransform: 'uppercase',
            whiteSpace: 'pre',
          }}
          aria-label={dayLabel}
        >
          {typedLabel}
          {typedLabel.length < dayLabel.length && <span className="type-caret" aria-hidden />}
        </span>
        <span aria-hidden style={{ width: 'clamp(40px, 8vw, 80px)', height: 1, background: T.ink }} />
      </div>

      {/* The stage — scribe and search occupy the same cell; one cross-fades into the other */}
      <div
        ref={stageRef}
        className="hero-stage reveal reveal-2"
        data-expanded={expanded}
      >
        {/* Scribe — the click target */}
        <button
          ref={scribeTriggerRef}
          type="button"
          onClick={() => setSearchState('expanded')}
          className="scribe-trigger"
          aria-label="Open the problem input"
          data-active={!expanded}
        >
          <img
            src={scribeSrc}
            alt=""
            aria-hidden
            style={{
              // Hold the image to its natural aspect ratio. Forcing an
              // explicit height alongside max-width: 100% lets narrow
              // viewports horizontally-squish the figure (the visual
              // "cropping" you'd see on mobile). Bounding both dimensions
              // and letting the image size itself keeps it crisp.
              maxHeight: 'clamp(160px, 26vh, 260px)',
              maxWidth: 'min(100%, 420px)',
              width: 'auto',
              height: 'auto',
              objectFit: 'contain',
              display: 'block',
            }}
          />
          <span className="scribe-hint">
            Type a problem →
          </span>
        </button>

        {/* Search form — emerges in place of the scribe */}
        <div className="search-form" data-active={expanded} aria-hidden={!expanded}>
          <textarea
            ref={textareaRef}
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
            onKeyDown={onTextareaKeyDown}
            onPaste={onTextareaPaste}
            disabled={busy || ocrState === 'reading'}
            aria-label="Math problem to walk through"
            placeholder="Paste or type a problem — anything from algebra to differential equations…"
            rows={3}
            style={{
              width: '100%',
              border: `1px solid ${T.ink}`,
              background: T.paper,
              padding: '16px 18px',
              fontSize: 16,
              fontFamily: T.mono,
              resize: 'vertical',
              color: T.ink,
              outline: 'none',
              lineHeight: 1.5,
              marginBottom: 14,
            }}
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!problem.trim() || busy}
              className="btn-press chamfer"
              style={{
                background: !problem.trim() || busy ? T.hair : T.accent,
                color: !problem.trim() || busy ? T.muted : T.paper,
                border: 'none',
                padding: '12px 22px',
                fontSize: 15,
                fontWeight: 500,
                cursor: !problem.trim() || busy ? 'not-allowed' : 'pointer',
                fontFamily: T.sans,
              }}
            >
              {busy ? 'Routing…' : 'Walk me through it →'}
            </button>
            <button
              type="button"
              onClick={() => void onScanClick()}
              disabled={ocrState === 'reading' || busy}
              aria-label="Scan a problem with your camera"
              className="btn-press"
              style={{
                background: 'transparent',
                border: `1px solid ${T.ink}`,
                padding: '11px 14px',
                fontSize: 13,
                fontWeight: 500,
                cursor: ocrState === 'reading' || busy ? 'not-allowed' : 'pointer',
                fontFamily: T.mono,
                letterSpacing: '0.08em',
                color: T.ink,
                marginLeft: 10,
              }}
            >
              {ocrState === 'reading' ? 'Reading…' : 'Scan'}
            </button>
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

          {searchState === 'no_match' && (
            <p
              role="status"
              aria-live="polite"
              style={{
                marginTop: 14,
                fontSize: 13,
                color: T.muted,
                lineHeight: 1.5,
              }}
            >
              Couldn't place that one — try rephrasing, or{' '}
              <button
                type="button"
                onClick={() => onNavigate({ name: 'subjects' })}
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
                pick a subject
              </button>{' '}
              instead.
            </p>
          )}
        </div>
      </div>

      {/* Daily Challenge — inline below the hero. Wordle-style ritual hook;
       *  see DailyChallengeCard for the no-help, photo-grade flow. */}
      <DailyChallengeCard onStartGrade={setActiveChallenge} />

      {/* Secondary CTAs — fade back when the search has focus */}
      <div
        className="reveal reveal-5"
        style={{
          marginTop: 'clamp(40px, 8vh, 72px)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          justifyContent: 'center',
          width: '100%',
          maxWidth: 640,
          opacity: expanded ? 0.35 : 1,
          transition: 'opacity 240ms ease-out',
        }}
      >
        <button
          type="button"
          onClick={() => onNavigate({ name: 'subjects' })}
          className="landing-cta-card"
        >
          <span className="cta-kicker">Explore</span>
          <span className="cta-title">Pick a subject</span>
          <span className="cta-sub">
            Nine college subjects, walked through one line at a time.
          </span>
          <span className="cta-arrow" aria-hidden>→</span>
        </button>

        <button
          type="button"
          onClick={onHomeworkClick}
          className="landing-cta-card"
        >
          <span className="cta-kicker">Plus · Pro</span>
          <span className="cta-title">Handwritten to PDF · LaTeX Mode</span>
          <span className="cta-sub">
            Snap your work. Pro adds a typeset LaTeX render.
          </span>
          <span className="cta-arrow" aria-hidden>→</span>
        </button>
      </div>

      {/* Features showcase — only renders for the marketing audience
       *  (signed-out users). Signed-in users already have access to
       *  these via tile/route navigation; cluttering their home doesn't
       *  add value. */}
      <SignedOut>
        <FeaturesShowcase />
      </SignedOut>

      <footer
        style={{
          marginTop: 64,
          display: 'flex',
          gap: 18,
          justifyContent: 'center',
          fontFamily: T.mono,
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: T.muted,
          flexWrap: 'wrap',
        }}
      >
        <a href="/pricing" style={{ color: T.muted, textDecoration: 'none' }}>Pricing</a>
        <span aria-hidden>·</span>
        <a href="/terms" style={{ color: T.muted, textDecoration: 'none' }}>Terms</a>
        <span aria-hidden>·</span>
        <a href="/privacy" style={{ color: T.muted, textDecoration: 'none' }}>Privacy</a>
      </footer>

      {/* Modal: photo capture + grade reveal + LaTeX render for the daily challenge */}
      {activeChallenge && (
        <ChallengeGradeFlow
          challenge={activeChallenge}
          onClose={() => setActiveChallenge(null)}
        />
      )}
    </main>
  );
}

function FeaturesShowcase() {
  return (
    <section
      style={{
        marginTop: 'clamp(72px, 14vh, 120px)',
        width: '100%',
        maxWidth: 960,
        alignSelf: 'center',
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontFamily: T.mono,
          letterSpacing: '0.18em',
          color: T.muted,
          textTransform: 'uppercase',
          marginBottom: 10,
          textAlign: 'center',
        }}
      >
        What MathIQ does
      </div>
      <h2
        style={{
          fontFamily: T.sans,
          fontSize: 'clamp(26px, 4.5vw, 36px)',
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: '-0.02em',
          margin: '0 auto 28px',
          textAlign: 'center',
          maxWidth: 560,
        }}
      >
        Type a problem. Or upload your handwritten work.
      </h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 12,
        }}
      >
        {SHOWCASE.map((f) => (
          <article key={f.title} className="landing-feature-card">
            <div className="cta-kicker" style={{ color: f.tierColor }}>
              {f.tier}
            </div>
            <h3 className="feature-card-title">{f.title}</h3>
            <p className="feature-card-sub">{f.sub}</p>
          </article>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 22 }}>
        <a
          href="/pricing"
          className="btn-press"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: 'transparent',
            border: `1px solid ${T.ink}`,
            color: T.ink,
            padding: '10px 18px',
            fontSize: 14,
            fontWeight: 500,
            fontFamily: T.sans,
            textDecoration: 'none',
            cursor: 'pointer',
          }}
        >
          See the plans →
        </a>
      </div>
    </section>
  );
}

interface ShowcaseEntry {
  tier: string;
  tierColor: string;
  title: string;
  sub: string;
}

const SHOWCASE: ShowcaseEntry[] = [
  {
    tier: 'Free',
    tierColor: 'var(--muted)',
    title: 'Step-by-step walkthroughs',
    sub: 'Iris explains every move — not just the answer. Five free per day across nine college subjects.',
  },
  {
    tier: 'Plus',
    tierColor: 'var(--accent)',
    title: 'Why & how reflection',
    sub: 'Tap any step to see the strategic reason behind it. The shift from "what to do" to "when this is the right move."',
  },
  {
    tier: 'Plus',
    tierColor: 'var(--accent)',
    title: 'Photo input',
    sub: 'Snap a problem from your textbook. Iris extracts the LaTeX and walks you through it.',
  },
  {
    tier: 'Plus',
    tierColor: 'var(--accent)',
    title: 'Handwritten to PDF',
    sub: 'Upload a photo or scan of your handwritten work. Mathpix transcribes it, Iris cleans it up, you print a submission-ready PDF.',
  },
  {
    tier: 'Pro',
    tierColor: 'var(--accent-2)',
    title: 'LaTeX Mode',
    sub: 'Same upload, but Pro compiles your handwriting into a Computer Modern-typeset PDF — indistinguishable from an Overleaf paper.',
  },
  {
    tier: 'Pro',
    tierColor: 'var(--accent-2)',
    title: 'Exam Mode + grading',
    sub: 'Generate full college exams, print them, upload your handwritten attempt. Per-problem scores with topic-level breakdown.',
  },
];
