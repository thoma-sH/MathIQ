import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { T } from '../design/tokens';
import { COURSES_BY_ID } from '../walkthroughs/courses';
import {
  ExamError,
  getExam,
  gradeExam,
  type ExamGradeResult,
  type ExamRecord,
} from '../walkthroughs/exam';
import { openScanner } from '../scanner';
import { NotFound } from './NotFound';
import type { Route } from '../router';

interface ExamGradeProps {
  courseId: string;
  recordId: string;
  onNavigate: (route: Route) => void;
}

type GradeState =
  | { kind: 'idle' }
  | { kind: 'grading' }
  | { kind: 'graded'; result: ExamGradeResult }
  | { kind: 'error'; message: string };

export function ExamGrade({ courseId, recordId, onNavigate }: ExamGradeProps) {
  const course = COURSES_BY_ID[courseId];
  const { getToken } = useAuth();
  const [record, setRecord] = useState<ExamRecord | null>(null);
  const [state, setState] = useState<GradeState>({ kind: 'idle' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Cache hit?
      try {
        const raw = sessionStorage.getItem(`exam:${recordId}`);
        if (raw) {
          const r = JSON.parse(raw) as ExamRecord;
          if (!cancelled) setRecord(r);
        }
      } catch {
        // ignore
      }
      // Always also fetch from worker so we get any existing grade.
      const result = await getExam({ examId: recordId, getToken });
      if (cancelled || !result) return;
      setRecord(result.record);
      try {
        sessionStorage.setItem(`exam:${recordId}`, JSON.stringify(result.record));
      } catch {
        // ignore
      }
      if (result.grade) {
        setState({ kind: 'graded', result: result.grade });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recordId, getToken]);

  async function onFile(file: File | null) {
    if (!file || !record) return;
    setState({ kind: 'grading' });
    try {
      const result = await gradeExam({ examId: record.examId, file, getToken });
      setState({ kind: 'graded', result });
    } catch (err) {
      const msg =
        err instanceof ExamError ? err.message : 'Grading failed — try again in a moment.';
      setState({ kind: 'error', message: msg });
    }
  }

  if (!course) {
    return (
      <NotFound message="That course doesn't exist." onNavigate={onNavigate} />
    );
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
        onClick={() => onNavigate({ name: 'exam-take', courseId, recordId })}
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
        ← Back to exam
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
        Grade my attempt.
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
        Upload a PDF or photo of your completed attempt — PDFs work best for
        multi-page exams. Iris will score each problem, flag the topics you missed,
        and recommend what to review.
      </p>

      {state.kind === 'idle' && record && <IdleCard onFile={onFile} />}

      {state.kind === 'idle' && !record && (
        <div
          style={{
            padding: '18px 22px',
            border: `1px solid ${T.ink}`,
            background: T.paper2,
            fontSize: 14,
            lineHeight: 1.55,
          }}
        >
          We couldn't find this exam in this browser session. Go back and start a fresh
          exam — exams are stored per session.
        </div>
      )}

      {state.kind === 'grading' && <GradingCard />}

      {state.kind === 'error' && (
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
          {state.message}
          <button
            type="button"
            onClick={() => setState({ kind: 'idle' })}
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
      )}

      {state.kind === 'graded' && (
        <GradeResultView
          result={state.result}
          onNavigate={onNavigate}
          courseId={courseId}
          onRegrade={() => setState({ kind: 'idle' })}
        />
      )}
    </main>
  );
}

function IdleCard({ onFile }: { onFile: (f: File | null) => void }) {
  async function onScan() {
    const out = await openScanner({
      mode: 'multi',
      output: 'pdf',
      filename: 'Attempt.pdf',
    });
    if (out && out.kind === 'pdf') onFile(out.file);
  }
  return (
    <section
      style={{
        padding: '24px',
        border: `1px solid ${T.ink}`,
        background: T.paper2,
      }}
    >
      <button
        type="button"
        onClick={() => void onScan()}
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
        Scan pages →
      </button>
      <p style={{ fontSize: 13, color: T.muted, lineHeight: 1.55, margin: '14px 0 0' }}>
        Snap each page of your attempt. Iris auto-crops, straightens, and
        bundles everything into one PDF — then scores it problem-by-problem.
      </p>
    </section>
  );
}

function GradingCard() {
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
      <div style={{ fontSize: 16, fontWeight: 600 }}>Iris is reading your attempt…</div>
      <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.55 }}>
        This takes 15–30 seconds. We're matching the photo to each problem, scoring
        the work, and looking for the patterns of error worth flagging.
      </div>
    </section>
  );
}

function GradeResultView({
  result,
  onNavigate,
  courseId,
  onRegrade,
}: {
  result: ExamGradeResult;
  onNavigate: (route: Route) => void;
  courseId: string;
  onRegrade: () => void;
}) {
  const pct = result.totalMax === 0 ? 0 : Math.round((result.totalScore / result.totalMax) * 100);
  const letter = pct >= 90 ? 'A' : pct >= 80 ? 'B' : pct >= 70 ? 'C' : pct >= 60 ? 'D' : 'F';

  return (
    <>
      <section
        style={{
          padding: '22px 24px',
          border: `1px solid ${T.ink}`,
          background: T.paper,
          marginBottom: 18,
          display: 'flex',
          gap: 24,
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span
            style={{
              fontSize: 11,
              fontFamily: T.mono,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: T.muted,
            }}
          >
            YOUR SCORE
          </span>
          <span style={{ fontSize: 36, fontWeight: 700, lineHeight: 1, letterSpacing: '-0.02em' }}>
            {result.totalScore} / {result.totalMax}
          </span>
          <span style={{ fontSize: 14, color: T.muted }}>
            {pct}% · {letter}
          </span>
        </div>
        <button
          type="button"
          onClick={onRegrade}
          className="btn-press chamfer"
          style={{
            background: 'transparent',
            color: T.ink,
            border: `1px solid ${T.ink}`,
            padding: '9px 16px',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: T.sans,
          }}
        >
          Upload a new attempt →
        </button>
      </section>

      {result.topicBreakdown.length > 0 && (
        <section style={{ marginBottom: 22 }}>
          <div
            style={{
              fontSize: 11,
              fontFamily: T.mono,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: T.muted,
              marginBottom: 8,
            }}
          >
            BY TOPIC
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {result.topicBreakdown
              .slice()
              .sort((a, b) => a.score / a.max - b.score / b.max)
              .map((t) => {
                const tpct = t.max === 0 ? 0 : Math.round((t.score / t.max) * 100);
                return (
                  <div
                    key={t.topicId}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 12,
                      padding: '8px 14px',
                      border: `1px solid ${T.hair}`,
                      background: T.paper2,
                      fontSize: 14,
                    }}
                  >
                    <span style={{ fontWeight: 500 }}>{t.topicTitle}</span>
                    <span style={{ color: tpct >= 70 ? T.ink : T.accent, fontFamily: T.mono, fontSize: 13 }}>
                      {t.score} / {t.max} · {tpct}%
                    </span>
                  </div>
                );
              })}
          </div>
        </section>
      )}

      {result.studyRecommendations.length > 0 && (
        <section style={{ marginBottom: 22 }}>
          <div
            style={{
              fontSize: 11,
              fontFamily: T.mono,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: T.muted,
              marginBottom: 8,
            }}
          >
            WHAT TO STUDY NEXT
          </div>
          <ul
            style={{
              margin: 0,
              padding: '14px 18px 14px 32px',
              border: `1px solid ${T.ink}`,
              background: T.paper,
              fontSize: 14,
              lineHeight: 1.55,
            }}
          >
            {result.studyRecommendations.map((rec, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {rec}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 8,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontFamily: T.mono,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: T.muted,
            }}
          >
            PROBLEM-BY-PROBLEM
          </div>
          <div
            style={{
              fontSize: 11,
              fontFamily: T.mono,
              letterSpacing: '0.08em',
              color: T.muted,
            }}
          >
            tap to expand
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {result.problems.map((p) => (
            <ProblemCard
              key={p.index}
              problem={p}
              onReview={() =>
                onNavigate({ name: 'topic', courseId, topicId: p.topicId })
              }
            />
          ))}
        </div>
      </section>
    </>
  );
}

type PipStatus = 'full' | 'partial' | 'missed';
function pipStatus(score: number, max: number): PipStatus {
  if (score >= 8) return 'full';
  if (score / Math.max(max, 1) >= 0.4) return 'partial';
  return 'missed';
}

function StatusPip({ status }: { status: PipStatus }) {
  const fill =
    status === 'full' ? T.accent3 : status === 'partial' ? T.accent2 : 'transparent';
  const stroke = status === 'missed' ? T.muted : fill;
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 9 9"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <circle cx="4.5" cy="4.5" r="3.5" fill={fill} stroke={stroke} strokeWidth="1" />
    </svg>
  );
}

function ProblemCard({
  problem: p,
  onReview,
}: {
  problem: ExamGradeResult['problems'][number];
  onReview: () => void;
}) {
  const status = pipStatus(p.score, p.max);
  return (
    <details
      className="disclosure"
      style={{
        border: `1px solid ${T.ink}`,
        background: p.correct ? T.paper : T.paper2,
      }}
    >
      <summary
        style={{
          padding: '13px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <span
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            flex: 1,
            minWidth: 0,
          }}
        >
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 10,
              fontFamily: T.mono,
              letterSpacing: '0.14em',
              color: T.muted,
              textTransform: 'uppercase',
            }}
          >
            <StatusPip status={status} />
            Problem {p.index}
          </span>
          <span style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.3 }}>
            {p.topicTitle}
          </span>
        </span>
        <span
          style={{
            fontFamily: T.mono,
            fontSize: 14,
            fontWeight: 600,
            color: p.correct ? T.accent3 : T.ink,
            whiteSpace: 'nowrap',
          }}
        >
          {p.score} <span style={{ color: T.muted, fontWeight: 400 }}>/ {p.max}</span>
        </span>
        <svg
          className="chev"
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3.5 5.5 L7 9 L10.5 5.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>
      <div
        className="reveal feedback-md"
        style={{
          padding: '12px 16px 16px',
          borderTop: `1px solid ${T.hair}`,
          fontSize: 14,
          lineHeight: 1.55,
        }}
      >
        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
          {p.feedback}
        </ReactMarkdown>
        {p.score < 8 && (
          <button
            type="button"
            onClick={onReview}
            className="btn-press"
            style={{
              marginTop: 12,
              background: 'transparent',
              border: 'none',
              padding: 0,
              fontSize: 13,
              color: T.accent,
              textDecoration: 'underline',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Review {p.topicTitle} →
          </button>
        )}
      </div>
    </details>
  );
}
