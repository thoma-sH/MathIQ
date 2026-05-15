/**
 * Daily Challenge card — inline on Landing/Home.
 *
 * Wordle-style: one problem visible to all visitors, no walkthrough access
 * or hints before submission. Anonymous users see the problem and can
 * photo-grade once per day (Turnstile-gated). Signed-in users get streak
 * tracking and an optional LaTeX render of their submission after grading.
 *
 * The card itself only displays the problem and routes to ChallengeGradeFlow
 * for the actual photo capture + grade reveal.
 */
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { SignedIn, useAuth } from '@clerk/clerk-react';
import { T } from '../design/tokens';
import {
  fetchStreak,
  fetchTodaysChallenge,
  type StreakState,
  type TodaysChallenge,
} from '../billing/challenge';

interface DailyChallengeCardProps {
  /** Called when the user taps the grade CTA. The parent opens the grade flow. */
  onStartGrade: (challenge: TodaysChallenge) => void;
}

const DIFFICULTY_LABEL: Record<TodaysChallenge['difficulty'], { label: string; emoji: string }> = {
  easy: { label: 'EASY', emoji: '🟢' },
  mid: { label: 'MID', emoji: '🟡' },
  hard: { label: 'HARD', emoji: '🟠' },
  cumulative: { label: 'SUNDAY', emoji: '🔴' },
};

export function DailyChallengeCard({ onStartGrade }: DailyChallengeCardProps) {
  const { getToken, isSignedIn } = useAuth();
  const [challenge, setChallenge] = useState<TodaysChallenge | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streak, setStreak] = useState<StreakState | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchTodaysChallenge().then((c) => {
      if (cancelled) return;
      if (!c) {
        setError("Today's challenge is being prepared — refresh in a moment.");
      } else {
        setChallenge(c);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

  if (loading) {
    return <ChallengeSkeleton />;
  }
  if (error || !challenge) {
    return (
      <div style={cardOuterStyle}>
        <div style={{ fontFamily: T.mono, fontSize: 12, color: T.muted, letterSpacing: '0.14em' }}>
          DAILY CHALLENGE
        </div>
        <p style={{ marginTop: 12, color: T.muted, fontSize: 14 }}>
          {error ?? "Today's challenge isn't available yet."}
        </p>
      </div>
    );
  }

  const diff = DIFFICULTY_LABEL[challenge.difficulty];

  return (
    <section
      className="reveal reveal-4"
      style={{
        ...cardOuterStyle,
        position: 'relative',
      }}
    >
      {/* Kicker row: DAILY · #N · DIFFICULTY · streak (right) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          fontFamily: T.mono,
          fontSize: 11,
          letterSpacing: '0.16em',
          color: T.muted,
          textTransform: 'uppercase',
          marginBottom: 12,
        }}
      >
        <span>
          DAILY · #{challenge.challengeNumber} · {diff.emoji} {diff.label}
        </span>
        <SignedIn>
          {streak && streak.current > 0 && (
            <span style={{ color: T.ink, fontWeight: 600 }}>
              🔥 {streak.current}-day
              {streak.freezes > 0 && (
                <span style={{ marginLeft: 8, color: T.muted, fontWeight: 500 }}>
                  ❄ {streak.freezes}
                </span>
              )}
            </span>
          )}
        </SignedIn>
      </div>

      {/* Topic title */}
      <h2
        style={{
          fontFamily: T.sans,
          fontSize: 'clamp(20px, 3.5vw, 24px)',
          fontWeight: 700,
          letterSpacing: '-0.015em',
          margin: '0 0 14px',
          color: T.ink,
        }}
      >
        {challenge.courseTitle} · {challenge.topicTitle}
      </h2>

      {/* Problem text (KaTeX-rendered) */}
      <div
        className="challenge-problem-body"
        style={{
          fontSize: 17,
          lineHeight: 1.55,
          color: T.ink,
          marginBottom: 20,
        }}
      >
        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
          {challenge.problemText}
        </ReactMarkdown>
      </div>

      {/* Primary CTA — single, Wordle-style: solve it yourself */}
      <button
        type="button"
        onClick={() => onStartGrade(challenge)}
        className="btn-press chamfer"
        style={{
          width: '100%',
          background: T.accent,
          color: T.paper,
          border: 'none',
          padding: '14px 18px',
          fontSize: 15,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: T.sans,
          minHeight: 48,
        }}
      >
        Snap your work to grade →
      </button>

      <p
        style={{
          marginTop: 10,
          fontSize: 12,
          color: T.muted,
          fontFamily: T.mono,
          letterSpacing: '0.06em',
          textAlign: 'center',
        }}
      >
        Solve it on paper · no hints · resets at midnight UTC
      </p>
    </section>
  );
}

const cardOuterStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 640,
  margin: '0 auto',
  padding: '24px 22px',
  background: T.paper2,
  border: `1px solid ${T.ink}`,
  marginTop: 'clamp(32px, 6vh, 56px)',
};

function ChallengeSkeleton() {
  return (
    <div
      style={{
        ...cardOuterStyle,
        opacity: 0.55,
      }}
    >
      <div
        style={{
          fontFamily: T.mono,
          fontSize: 11,
          letterSpacing: '0.16em',
          color: T.muted,
          textTransform: 'uppercase',
          marginBottom: 12,
        }}
      >
        DAILY CHALLENGE
      </div>
      <div
        style={{
          height: 26,
          width: '60%',
          background: T.hair,
          marginBottom: 14,
        }}
      />
      <div style={{ height: 18, width: '90%', background: T.hair, marginBottom: 8 }} />
      <div style={{ height: 18, width: '70%', background: T.hair, marginBottom: 20 }} />
      <div style={{ height: 48, width: '100%', background: T.hair }} />
    </div>
  );
}
