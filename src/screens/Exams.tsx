import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { T } from '../design/tokens';
import { COURSES_BY_ID } from '../walkthroughs/courses';
import { generateExam, ExamError } from '../walkthroughs/exam';
import { fetchSubscriptionState, type Tier } from '../billing/client';
import { isPro } from '../walkthroughs/tier';
import { NotFound } from './NotFound';
import type { Route, ExamId } from '../router';

interface ExamsProps {
  courseId: string;
  onNavigate: (route: Route) => void;
}

interface ExamSpec {
  id: ExamId;
  title: string;
  topicRangeLabel: (totalTopics: number) => string;
  blurb: string;
}

const EXAMS: ExamSpec[] = [
  {
    id: 'exam1',
    title: 'Exam 1',
    topicRangeLabel: () => 'Topics 1–4',
    blurb: 'First-unit coverage. Routine problems from the foundational topics.',
  },
  {
    id: 'exam2',
    title: 'Exam 2',
    topicRangeLabel: () => 'Topics 5–8',
    blurb: 'Middle of the course. Builds on Exam 1, no overlap.',
  },
  {
    id: 'exam3',
    title: 'Exam 3',
    topicRangeLabel: () => 'Topics 9–12',
    blurb: 'Final unit before the cumulative. The hardest individual exam.',
  },
  {
    id: 'final',
    title: 'Final Exam',
    topicRangeLabel: (total) => `All ${total} topics (cumulative)`,
    blurb: 'Cumulative across the whole course. Mix of routine and hard problems.',
  },
];

export function Exams({ courseId, onNavigate }: ExamsProps) {
  const course = COURSES_BY_ID[courseId];
  const { getToken } = useAuth();
  const [tier, setTier] = useState<Tier | null>(null);
  const [tierLoaded, setTierLoaded] = useState(false);
  const [pendingExam, setPendingExam] = useState<ExamId | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sub = await fetchSubscriptionState({ getToken });
      if (!cancelled) {
        setTier(sub?.tier ?? null);
        setTierLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  if (!course) {
    return (
      <NotFound
        message="That course doesn't exist — it may have been renamed or removed."
        onNavigate={onNavigate}
      />
    );
  }

  async function startExam(examId: ExamId) {
    setError(null);
    setPendingExam(examId);
    try {
      const record = await generateExam({ courseId, exam: examId, getToken });
      try {
        sessionStorage.setItem(`exam:${record.examId}`, JSON.stringify(record));
        sessionStorage.setItem(`exam-current:${courseId}:${examId}`, record.examId);
      } catch {
        // ignore quota
      }
      onNavigate({ name: 'exam-take', courseId, examId });
    } catch (err) {
      if (err instanceof ExamError) {
        setError(err.message);
      } else {
        setError('Exam generation failed — try again in a moment.');
      }
      setPendingExam(null);
    }
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
        onClick={() => onNavigate({ name: 'walkthrough', courseId })}
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
        ← {course.title}
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
        Exam mode.
      </h1>
      <p
        className="reveal reveal-2"
        style={{
          fontSize: 16,
          color: T.muted,
          lineHeight: 1.55,
          margin: '0 0 28px',
          maxWidth: 540,
        }}
      >
        Generate a professional, print-ready exam for {course.title}. No hints, no
        freebies — just problems.
      </p>

      {tierLoaded && !isPro(tier) && <UpgradeStrip onUpgrade={() => onNavigate({ name: 'settings' })} />}

      <div
        className="stagger-children"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: 14,
          marginTop: 18,
        }}
      >
        {EXAMS.map((spec) => (
          <ExamCard
            key={spec.id}
            spec={spec}
            totalTopics={course.topics.length}
            disabled={!tierLoaded || !isPro(tier) || pendingExam !== null}
            loading={pendingExam === spec.id}
            onStart={() => void startExam(spec.id)}
          />
        ))}
      </div>

      {error && (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginTop: 16,
            padding: '10px 14px',
            border: `1px solid ${T.ink}`,
            background: T.paper2,
            fontSize: 13,
            color: T.ink,
            fontFamily: T.mono,
          }}
        >
          {error}
        </div>
      )}

      <p
        style={{
          marginTop: 28,
          fontSize: 13,
          color: T.muted,
          lineHeight: 1.55,
          fontFamily: T.mono,
          letterSpacing: '0.05em',
        }}
      >
        Each exam costs 1 of your 70 daily Pro slots.
      </p>
    </main>
  );
}

function ExamCard({
  spec,
  totalTopics,
  disabled,
  loading,
  onStart,
}: {
  spec: ExamSpec;
  totalTopics: number;
  disabled: boolean;
  loading: boolean;
  onStart: () => void;
}) {
  return (
    <article
      style={{
        border: `1px solid ${T.ink}`,
        background: T.paper,
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ fontSize: 11, fontFamily: T.mono, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.muted }}>
        {spec.topicRangeLabel(totalTopics)}
      </div>
      <h3 style={{ fontSize: 22, fontWeight: 700, margin: '2px 0 4px', letterSpacing: '-0.01em' }}>
        {spec.title}
      </h3>
      <p style={{ fontSize: 14, lineHeight: 1.5, color: T.ink, margin: 0 }}>
        {spec.blurb}
      </p>
      <button
        type="button"
        onClick={onStart}
        disabled={disabled}
        className="btn-press chamfer"
        style={{
          marginTop: 10,
          background: disabled ? 'transparent' : T.accent,
          color: disabled ? T.muted : T.paper,
          border: `1px solid ${disabled ? T.hair : T.ink}`,
          padding: '9px 16px',
          fontSize: 13,
          fontWeight: 500,
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontFamily: T.sans,
          alignSelf: 'flex-start',
        }}
      >
        {loading ? 'Generating…' : 'Start exam →'}
      </button>
    </article>
  );
}

function UpgradeStrip({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <div
      style={{
        marginTop: 4,
        padding: '14px 18px',
        border: `1px solid ${T.ink}`,
        background: T.paper2,
        fontSize: 14,
        lineHeight: 1.55,
        color: T.ink,
      }}
    >
      Exam mode is a <strong>MathIQ Pro</strong> feature ($29.99/mo, $19.99/mo annual).{' '}
      <button
        type="button"
        onClick={onUpgrade}
        className="btn-press"
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          fontSize: 14,
          color: T.accent,
          textDecoration: 'underline',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        Upgrade →
      </button>
    </div>
  );
}
