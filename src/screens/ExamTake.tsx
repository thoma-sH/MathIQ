import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { T } from '../design/tokens';
import { COURSES_BY_ID } from '../walkthroughs/courses';
import type { ExamRecord } from '../walkthroughs/exam';
import { NotFound } from './NotFound';
import type { Route, ExamId } from '../router';

interface ExamTakeProps {
  courseId: string;
  examId: ExamId;
  onNavigate: (route: Route) => void;
}

export function ExamTake({ courseId, examId, onNavigate }: ExamTakeProps) {
  const course = COURSES_BY_ID[courseId];
  const [record, setRecord] = useState<ExamRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    // Pick up the freshly-generated exam from sessionStorage. The Exams
    // screen caches the record under:
    //   exam-current:<courseId>:<examId> → the most recent record id for this slot
    //   exam:<recordId>                  → the full record
    try {
      const currentId = sessionStorage.getItem(`exam-current:${courseId}:${examId}`);
      if (currentId) {
        const raw = sessionStorage.getItem(`exam:${currentId}`);
        if (raw) setRecord(JSON.parse(raw) as ExamRecord);
      }
    } catch {
      // ignore
    }
    setLoaded(true);
  }, [courseId, examId]);

  useEffect(() => {
    if (!printing) return;
    const t = setTimeout(() => {
      window.print();
      setTimeout(() => setPrinting(false), 200);
    }, 50);
    return () => clearTimeout(t);
  }, [printing]);

  if (!course) {
    return <NotFound message="That course doesn't exist." onNavigate={onNavigate} />;
  }

  if (!loaded) {
    return (
      <main className="responsive-pad" style={{ maxWidth: 760, margin: '0 auto', paddingTop: 24 }}>
        <div style={{ fontSize: 13, color: T.muted }}>Loading…</div>
      </main>
    );
  }

  if (!record) {
    return (
      <main
        className="responsive-pad"
        style={{ maxWidth: 760, margin: '0 auto', paddingTop: 24, paddingBottom: 96 }}
      >
        <h1 style={{ fontSize: 'clamp(28px, 6vw, 38px)', fontWeight: 700, margin: '0 0 12px' }}>
          Exam not loaded.
        </h1>
        <p style={{ fontSize: 16, color: T.muted, lineHeight: 1.55, margin: '0 0 24px' }}>
          We couldn't find this exam in this browser session. Go back and start a fresh exam.
        </p>
        <button
          onClick={() => onNavigate({ name: 'exams', courseId })}
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
          Back to exams →
        </button>
      </main>
    );
  }

  return (
    <main
      className="responsive-pad"
      style={{ maxWidth: 760, margin: '0 auto', paddingTop: 24, paddingBottom: 96 }}
    >
      <button
        onClick={() => onNavigate({ name: 'exams', courseId })}
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
        ← Exams
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 24 }}>
        <span style={{ fontSize: 12, fontFamily: T.mono, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.muted }}>
          {record.courseTitle}
        </span>
        <h1
          style={{
            fontFamily: T.sans,
            fontSize: 'clamp(32px, 7vw, 48px)',
            fontWeight: 700,
            lineHeight: 1.0,
            letterSpacing: '-0.025em',
            margin: 0,
          }}
        >
          {record.examTitle}
        </h1>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        <button
          type="button"
          onClick={() => setPrinting(true)}
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
          Print / Save as PDF
        </button>
        <button
          type="button"
          onClick={() => onNavigate({ name: 'exam-grade', courseId, examId })}
          className="btn-press chamfer"
          style={{
            background: 'transparent',
            color: T.ink,
            border: `1px solid ${T.ink}`,
            padding: '10px 18px',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: T.sans,
          }}
        >
          I'm done — grade my attempt →
        </button>
      </div>

      <p
        style={{
          fontSize: 13,
          color: T.muted,
          fontFamily: T.mono,
          lineHeight: 1.55,
          marginBottom: 24,
          letterSpacing: '0.04em',
        }}
      >
        On iPhone: tap Print → pinch the preview → Save to Files.
      </p>

      <section
        style={{
          border: `1px solid ${T.ink}`,
          background: T.paper,
          padding: '20px 22px',
          marginBottom: 18,
        }}
      >
        <div style={{ fontSize: 11, fontFamily: T.mono, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.muted, marginBottom: 6 }}>
          INSTRUCTIONS
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.6 }}>
          <li>Show all work on each problem.</li>
          <li>Scientific calculator allowed. No graphing calculators or outside resources.</li>
          <li>Number your work to match each problem.</li>
        </ul>
      </section>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {record.problems.map((p) => (
          <article
            key={p.index}
            style={{
              border: `1px solid ${T.ink}`,
              background: T.paper2,
              padding: '18px 20px',
            }}
          >
            <div style={{ fontSize: 11, fontFamily: T.mono, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.muted, marginBottom: 4 }}>
              Problem {p.index} · {p.topicTitle}
            </div>
            <div className="markdown-body" style={{ fontSize: 15, lineHeight: 1.55 }}>
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {p.problemText}
              </ReactMarkdown>
            </div>
          </article>
        ))}
      </div>

      {printing && <ExamPrintHost record={record} />}
    </main>
  );
}

function ExamPrintHost({ record }: { record: ExamRecord }) {
  const generated = new Date(record.createdAt).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  return createPortal(
    <div className="print-host" aria-hidden>
      <article className="exam-doc">
        <header className="exam-header">
          <div className="exam-course">{record.courseTitle}</div>
          <h1 className="exam-title">{record.examTitle}</h1>
          <div className="exam-meta">
            Name: ________________________ &nbsp; Date: {generated}
          </div>
          <div className="exam-instructions">
            Show all work. Scientific calculator allowed; no graphing calculators or outside resources. Number your answers to match each problem.
          </div>
        </header>
        {record.problems.map((p) => (
          <section key={p.index} className="exam-problem">
            <div className="exam-problem-label">Problem {p.index}</div>
            <div className="exam-problem-topic">{p.topicTitle}</div>
            <div className="markdown-body exam-problem-body">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {p.problemText}
              </ReactMarkdown>
            </div>
            <div className="exam-workspace" aria-hidden></div>
          </section>
        ))}
        <div className="print-footer">MathIQ · math-iq.vercel.app · Exam {record.examId}</div>
      </article>
    </div>,
    document.body,
  );
}
