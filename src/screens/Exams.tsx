import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { T } from '../design/tokens';
import { COURSES_BY_ID } from '../walkthroughs/courses';
import {
  generateExam,
  listExams,
  ExamError,
  type ExamListEntry,
} from '../walkthroughs/exam';
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
    topicRangeLabel: () => 'Topics 1–4 · 10 problems',
    blurb: 'First-unit coverage. Routine textbook-style problems from the foundational topics.',
  },
  {
    id: 'exam2',
    title: 'Exam 2',
    topicRangeLabel: () => 'Topics 5–8 · 10 problems',
    blurb: 'Middle of the course. Builds on Exam 1, no overlap.',
  },
  {
    id: 'exam3',
    title: 'Exam 3',
    topicRangeLabel: () => 'Topics 9–12 · 10 problems',
    blurb: 'The third unit. Same accessible difficulty as the first two.',
  },
  {
    id: 'final',
    title: 'Final Exam',
    topicRangeLabel: (total) => `All ${total} topics · 15 problems`,
    blurb: 'Cumulative across the whole course. One slightly harder stretch problem; the rest is routine.',
  },
];

export function Exams({ courseId, onNavigate }: ExamsProps) {
  const course = COURSES_BY_ID[courseId];
  const { getToken } = useAuth();
  const [tier, setTier] = useState<Tier | null>(null);
  const [tierLoaded, setTierLoaded] = useState(false);
  const [pendingExam, setPendingExam] = useState<ExamId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pastExams, setPastExams] = useState<ExamListEntry[] | null>(null);

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

  // Load past exams for this course (Pro only — endpoint 403s otherwise).
  useEffect(() => {
    if (!tierLoaded || !isPro(tier)) return;
    let cancelled = false;
    void (async () => {
      const items = await listExams({ courseId, getToken });
      if (!cancelled) setPastExams(items);
    })();
    return () => {
      cancelled = true;
    };
  }, [tierLoaded, tier, courseId, getToken]);

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
      } catch {
        // ignore quota
      }
      onNavigate({ name: 'exam-take', courseId, recordId: record.examId });
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
        freebies — just problems. Complete it on paper, then upload a photo to have
        Iris grade your attempt.
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
        Each exam costs 1 of your 70 daily Pro slots. Exams are stored for 30 days
        so you can grade your attempt later.
      </p>

      <section style={{ marginTop: 32 }}>
        <h2
          style={{
            fontFamily: T.sans,
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: '-0.01em',
            margin: '0 0 12px',
          }}
        >
          Homework Helper
        </h2>
        <button
          type="button"
          onClick={() => onNavigate({ name: 'homework' })}
          className="btn-press chamfer"
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '16px 18px',
            background: T.paper2,
            border: `1px solid ${T.ink}`,
            color: T.ink,
            fontFamily: T.sans,
            cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
            Turn your handwritten work into a PDF →
          </div>
          <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.5 }}>
            Snap a photo or upload a scan. Iris transcribes it; Pro adds a full
            LaTeX-typeset version for the cleanest possible turn-in.
          </div>
        </button>
      </section>

      {pastExams && pastExams.length > 0 && (
        <section style={{ marginTop: 36 }}>
          <h2
            style={{
              fontFamily: T.sans,
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: '-0.01em',
              margin: '0 0 12px',
            }}
          >
            Past attempts
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pastExams.map((p) => (
              <PastAttemptRow
                key={p.examId}
                entry={p}
                onOpen={() => onNavigate({ name: 'exam-take', courseId, recordId: p.examId })}
                onGrade={() => onNavigate({ name: 'exam-grade', courseId, recordId: p.examId })}
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function PastAttemptRow({
  entry,
  onOpen,
  onGrade,
}: {
  entry: ExamListEntry;
  onOpen: () => void;
  onGrade: () => void;
}) {
  const created = new Date(entry.createdAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const pct =
    entry.graded && typeof entry.totalScore === 'number' && typeof entry.totalMax === 'number' && entry.totalMax > 0
      ? Math.round((entry.totalScore / entry.totalMax) * 100)
      : null;
  return (
    <article
      style={{
        border: `1px solid ${T.ink}`,
        background: T.paper2,
        padding: '12px 16px',
        display: 'flex',
        gap: 16,
        alignItems: 'center',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 200 }}>
        <span style={{ fontSize: 11, fontFamily: T.mono, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.muted }}>
          {entry.examTitle} · {entry.problemCount} problems · {created}
        </span>
        <span style={{ fontSize: 14, color: T.ink }}>
          {entry.graded ? (
            <>
              Graded · {entry.totalScore} / {entry.totalMax} ({pct}%)
            </>
          ) : (
            <em style={{ color: T.muted }}>Not yet graded</em>
          )}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={onOpen}
          className="btn-press"
          style={{
            background: 'transparent',
            border: `1px solid ${T.ink}`,
            padding: '6px 12px',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: T.sans,
          }}
        >
          View / print
        </button>
        <button
          type="button"
          onClick={onGrade}
          className="btn-press"
          style={{
            background: entry.graded ? 'transparent' : T.accent,
            color: entry.graded ? T.ink : T.paper,
            border: entry.graded ? `1px solid ${T.ink}` : 'none',
            padding: '6px 12px',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: T.sans,
          }}
        >
          {entry.graded ? 'View grades' : 'Grade attempt →'}
        </button>
      </div>
    </article>
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
      Exam mode is a <strong>MathIQ Pro</strong> feature ($29.99/mo, $19.99/mo annual). Pro adds
      generated exams, photo grading, and PDF downloads of every walkthrough.{' '}
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
