import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { SignedOut, useAuth, useUser } from '@clerk/clerk-react';
import { T } from '../design/tokens';
import { getDailyContent } from '../state/dailyScribe';
import { useTypedString } from '../state/useTypedString';
import { ClassifyError, classifyTopic } from '../walkthroughs/classify';
import { looksLikeProblem } from '../walkthroughs/isProblem';
import { extractProblemFromImage, OcrError } from '../walkthroughs/ocr';
import { fetchSubscriptionState, type Tier } from '../billing/client';
import { fetchTodaysChallenge, fetchStreak, type TodaysChallenge, type StreakState } from '../billing/challenge';
import { isPaid } from '../walkthroughs/tier';
import { useUpgradePrompt } from '../upgrade/UpgradePrompt';
import { openScanner } from '../scanner';
import { hasUnfilledBody, latexToProblem, problemToLatex } from '../lib/problemLatex';
import { DifficultyChip } from '../design/icons';
import type { Route } from '../router';

// mathlive is over a megabyte and only the hero needs it. Imported statically
// it rode into the initial bundle of every route — /privacy, /pricing and a
// shared challenge included. Landing itself stays in the initial bundle so
// the rest of the page paints while the field is still on its way.
const MathEntry = lazy(() =>
  import('../components/MathEntry').then((m) => ({ default: m.MathEntry })),
);

interface LandingProps {
  onNavigate: (route: Route) => void;
}

/** `failed` is a search that never got an answer — offline, out of searches,
 *  the worker down — as opposed to `no_match`, which is an answer of "nowhere". */
type SearchState = 'idle' | 'classifying' | 'no_match' | 'failed';

function getTimeGreeting(hour: number): string {
  if (hour < 5) return 'Up late';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 22) return 'Good evening';
  return 'Good night';
}

export function Landing({ onNavigate }: LandingProps) {
  const { getToken, isSignedIn } = useAuth();
  const { user } = useUser();
  const { dayLabel, scribeSrc, scribeFillSrc } = useMemo(() => getDailyContent(), []);
  const typedLabel = useTypedString(dayLabel, 40, 220);

  const personalGreeting = useMemo(() => {
    const firstName = user?.firstName?.trim();
    if (!firstName) return null;
    return `${getTimeGreeting(new Date().getHours())}, ${firstName}.`;
  }, [user?.firstName]);

  const [searchState, setSearchState] = useState<SearchState>('idle');
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  // Raw mathfield LaTeX. Converted only on the way out (submit) and the way
  // in (OCR) — see problemLatex.ts for why it can't round-trip through the
  // converted form.
  const [problem, setProblem] = useState('');
  const [ocrState, setOcrState] = useState<'idle' | 'reading' | 'error'>('idle');
  const [ocrMessage, setOcrMessage] = useState<string | null>(null);
  const [tier, setTier] = useState<Tier | null>(null);
  const [dailyTease, setDailyTease] = useState<TodaysChallenge | null>(null);
  const [streak, setStreak] = useState<StreakState | null>(null);
  const { requireUpgrade } = useUpgradePrompt();
  const unready = !problem.trim() || hasUnfilledBody(problem);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sub = await fetchSubscriptionState({ getToken });
      if (!cancelled) setTier(sub?.tier ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, getToken]);

  useEffect(() => {
    let cancelled = false;
    void fetchTodaysChallenge().then((c) => {
      if (!cancelled && c) setDailyTease(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Streak fetch is signed-in only — the worker rejects /api/streak without auth.
  // Drives the daily card's urgency state when a streak is at risk.
  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    void fetchStreak({ getToken }).then((s) => {
      if (!cancelled) setStreak(s);
    });
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, getToken]);

  const todayUtc = new Date().toISOString().slice(0, 10);
  const streakAtRisk =
    !!streak && streak.current > 0 && streak.lastSolvedDate !== todayUtc;

  function onHomeworkClick() {
    if (!isPaid(tier)) {
      requireUpgrade('homework-plain', {
        onTryFree: () => onNavigate({ name: 'homework' }),
      });
      return;
    }
    onNavigate({ name: 'homework' });
  }
  async function submit() {
    // With smartMode on, a typed topic name leaves the field as `\text{…}`,
    // which reads as a LaTeX command to the heuristic below. Converting first
    // is what keeps "related rates" from auto-firing a walkthrough.
    const trimmed = latexToProblem(problem);
    if (!trimmed) return;
    setSearchState('classifying');
    setSearchMessage(null);
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
    } catch (err) {
      if (err instanceof ClassifyError) {
        setSearchMessage(err.message);
        setSearchState('failed');
        return;
      }
      setSearchState('no_match');
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
      // OCR answers in prose with $…$ math; the field wants LaTeX. Set raw,
      // the prose becomes italic variables and each `$` an error glyph.
      setProblem(problemToLatex(text));
      setOcrState('idle');
      setOcrMessage(null);
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

  const busy = searchState === 'classifying';

  return (
    <main
      className="responsive-pad"
      style={{
        maxWidth: 760,
        margin: '0 auto',
        paddingTop: 'clamp(32px, 7vh, 100px)',
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
          marginBottom: 'clamp(24px, 5vh, 44px)',
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

      {/* Daily challenge — compact button card sitting between the day kicker
       *  and the Scribe. Whole card is a link to /daily; the Scribe stays the
       *  primary hero element so we don't compete with it. */}
      {dailyTease && (
        <a
          href="/daily"
          className="reveal reveal-3 lift btn-press"
          style={{
            display: 'block',
            width: '100%',
            maxWidth: 440,
            padding: '14px 18px',
            border: `1px solid ${T.ink}`,
            background: T.paper2,
            color: T.ink,
            textDecoration: 'none',
            marginBottom: 'clamp(24px, 5vh, 44px)',
            textAlign: 'left',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <span
              style={{
                fontFamily: T.mono,
                fontSize: 11,
                letterSpacing: '0.18em',
                color: T.muted,
                textTransform: 'uppercase',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <span>DAILY · #{dailyTease.challengeNumber}</span>
              <span aria-hidden>·</span>
              <DifficultyChip tier={dailyTease.difficulty} />
            </span>
            <span
              className="arrow-nudge"
              aria-hidden
              style={{ fontSize: 18, color: T.muted, flexShrink: 0 }}
            >
              →
            </span>
          </div>
          <div
            style={{
              fontFamily: T.sans,
              fontSize: 17,
              fontWeight: 600,
              lineHeight: 1.25,
              letterSpacing: '-0.01em',
              marginTop: 6,
            }}
          >
            {dailyTease.courseTitle} · {dailyTease.topicTitle}
          </div>
          <div
            style={{
              fontFamily: T.mono,
              fontSize: 11,
              letterSpacing: '0.14em',
              color: T.accent,
              textTransform: 'uppercase',
              marginTop: 8,
            }}
          >
            {streakAtRisk
              ? `Streak · ${streak!.current} · ends tonight`
              : 'Solve today'}
          </div>
        </a>
      )}

      {/* The stage — the daily figure over an always-open math entry */}
      <div className="hero-stage reveal reveal-2">
        <span
          className="scribe-art"
          style={
            {
              '--scribe': `url(${scribeSrc})`,
              '--scribe-fill': `url(${scribeFillSrc})`,
            } as React.CSSProperties
          }
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
        </span>

        {/* The label the sweep lives on — it names the field below it. */}
        <span className="scribe-hint" id="math-entry-label">
          Type a problem →
        </span>

        <div className="search-form">
          <Suspense
            fallback={
              // The field's own footprint (72px + hairline), so the page
              // doesn't jump when the editor lands.
              <div
                aria-busy="true"
                style={{ minHeight: 74, border: `1px solid ${T.hair}`, background: T.paper2 }}
              />
            }
          >
            <MathEntry
              value={problem}
              onChange={(latex) => {
                setProblem(latex);
                // Editing after a miss should clear the miss.
                if (searchState === 'no_match' || searchState === 'failed') {
                  setSearchState('idle');
                }
              }}
              onSubmit={() => void submit()}
              onPasteImage={(file) => void handleImageFile(file)}
              disabled={busy || ocrState === 'reading'}
            />
          </Suspense>
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
              disabled={unready || busy}
              className="btn-press chamfer"
              style={{
                background: unready || busy ? T.hair : T.accent,
                color: unready || busy ? T.muted : T.paper,
                border: 'none',
                padding: '12px 22px',
                fontSize: 15,
                fontWeight: 500,
                cursor: unready || busy ? 'not-allowed' : 'pointer',
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

          {searchState === 'failed' && searchMessage && (
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
              {searchMessage} Or{' '}
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
        <FeaturesShowcase onNavigate={onNavigate} />
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

    </main>
  );
}

function FeaturesShowcase({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const [expanded, setExpanded] = useState<number | null>(null);

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
        {SHOWCASE.map((f, i) => {
          const isExpanded = expanded === i;
          return (
            <article
              key={f.title}
              className={`landing-feature-card${isExpanded ? ' is-expanded' : ''}`}
              style={isExpanded ? { gridColumn: '1 / -1' } : undefined}
            >
              <button
                type="button"
                className="feature-card-header"
                aria-expanded={isExpanded}
                aria-controls={`feature-details-${i}`}
                onClick={() => setExpanded(isExpanded ? null : i)}
              >
                <div className="cta-kicker" style={{ color: f.tierColor }}>
                  {f.tier}
                </div>
                <h3 className="feature-card-title">{f.title}</h3>
                <p className="feature-card-sub">{f.sub}</p>
                <span aria-hidden className="feature-card-indicator">
                  {isExpanded ? '−' : '+'}
                </span>
              </button>
              {isExpanded && (
                <div id={`feature-details-${i}`} className="feature-card-details">
                  <p className="feature-card-deep">{f.deep}</p>
                  <FeatureCta cta={f.cta} onNavigate={onNavigate} />
                </div>
              )}
            </article>
          );
        })}
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

function FeatureCta({
  cta,
  onNavigate,
}: {
  cta: ShowcaseCta;
  onNavigate: (route: Route) => void;
}) {
  if (cta.kind === 'route') {
    return (
      <button
        type="button"
        onClick={() => onNavigate(cta.route)}
        className="btn-press chamfer feature-card-cta"
      >
        {cta.label} →
      </button>
    );
  }
  return (
    <a href={cta.href} className="btn-press chamfer feature-card-cta">
      {cta.label} →
    </a>
  );
}

type ShowcaseCta =
  | { kind: 'route'; label: string; route: Route }
  | { kind: 'href'; label: string; href: string };

interface ShowcaseEntry {
  tier: string;
  tierColor: string;
  title: string;
  sub: string;
  deep: string;
  cta: ShowcaseCta;
}

const SHOWCASE: ShowcaseEntry[] = [
  {
    tier: 'Free',
    tierColor: 'var(--muted)',
    title: 'Step-by-step walkthroughs',
    sub: 'Iris explains every move — not just the answer. Five free per day across nine college subjects.',
    deep: 'Each step lands one line at a time with a short note on why that move is the right one. You set the pace — tap forward when you\'re ready, back up, or jump ahead. Spans algebra, precalc, calc 1/2/3, discrete, combinatorics, linear algebra, and number theory.',
    cta: { kind: 'route', label: 'Pick a subject', route: { name: 'subjects' } },
  },
  {
    tier: 'Plus',
    tierColor: 'var(--accent)',
    title: 'Why & how reflection',
    sub: 'Tap any step to see the strategic reason behind it. The shift from "what to do" to "when this is the right move."',
    deep: 'Most tutorials show what to do. Reflection surfaces when it\'s the right move and what would change if the problem were slightly different. Same line, viewed through the pattern recognition you\'ll need at exam time.',
    cta: { kind: 'href', label: 'See the Plus plan', href: '/pricing' },
  },
  {
    tier: 'Plus',
    tierColor: 'var(--accent)',
    title: 'Photo input',
    sub: 'Snap a problem from your textbook. Iris extracts the LaTeX and walks you through it.',
    deep: 'Point your phone at the page. Mathpix extracts the problem — equations and all — into clean LaTeX. Iris reads it back so you can confirm the transcription, then walks you through it like you\'d typed it yourself.',
    cta: { kind: 'href', label: 'See the Plus plan', href: '/pricing' },
  },
  {
    tier: 'Plus',
    tierColor: 'var(--accent)',
    title: 'Handwritten to PDF',
    sub: 'Photo of your handwriting in, a faithful typeset PDF out. Mathpix transcribes, we typeset — your exact work, just neater to read.',
    deep: 'Your work, transcribed: messy fractions, crossed-out lines, and all. Pages out as a clean PDF that reads like a textbook — same answers, same approach, just legible. Built for homework you\'ve already done and need to turn in.',
    cta: { kind: 'href', label: 'See the Plus plan', href: '/pricing' },
  },
  {
    tier: 'Pro',
    tierColor: 'var(--accent)',
    title: 'LaTeX Mode',
    sub: 'Same upload, but Pro typesets your handwriting in true Computer Modern LaTeX — preserved byte-for-byte, output looks like Overleaf.',
    deep: 'Same upload as Handwritten to PDF, but the output is real Computer Modern LaTeX. Useful for proof-heavy classes where presentation matters.',
    cta: { kind: 'href', label: 'See the Pro plan', href: '/pricing' },
  },
  {
    tier: 'Pro',
    tierColor: 'var(--accent)',
    title: 'Exam Mode + grading',
    sub: 'Generate full college exams, print them, upload your handwritten attempt. Per-problem scores with topic-level breakdown.',
    deep: 'Pick a course and the topics you want covered, get a printable exam scaled to your level. Take it on paper, snap it back in, and get per-problem feedback with a topic-level breakdown so you know exactly what to drill next.',
    cta: { kind: 'href', label: 'See the Pro plan', href: '/pricing' },
  },
];
