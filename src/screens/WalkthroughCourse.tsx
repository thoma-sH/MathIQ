import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { T } from '../design/tokens';
import { COURSES_BY_ID } from '../walkthroughs/courses';
import type { Topic } from '../walkthroughs/types';
import type { Route } from '../router';

interface WalkthroughCourseProps {
  courseId: string;
  onNavigate: (route: Route) => void;
}

function TopicCard({
  topic,
  onOpen,
}: {
  topic: Topic;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="lift btn-press"
      style={{
        background: 'transparent',
        border: `1px solid ${T.ink}`,
        padding: '18px 20px',
        textAlign: 'left',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        fontFamily: 'inherit',
        color: T.ink,
        borderRadius: 0,
        width: '100%',
        position: 'relative',
      }}
    >
      <div
        style={{
          fontSize: 19,
          fontWeight: 700,
          lineHeight: 1.2,
          letterSpacing: '-0.01em',
        }}
      >
        {topic.title}
      </div>
      <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.4 }}>
        {topic.blurb}
      </div>
      <div
        className="markdown-body"
        style={{
          marginTop: 4,
          padding: '8px 12px',
          background: T.paper2,
          border: `1px solid ${T.hair}`,
          fontSize: 14,
          overflowX: 'auto',
        }}
      >
        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
          {topic.exampleProblem}
        </ReactMarkdown>
      </div>
      <span
        className="arrow-nudge"
        aria-hidden
        style={{
          position: 'absolute',
          right: 16,
          top: 16,
          fontSize: 18,
          color: T.muted,
        }}
      >
        →
      </span>
    </button>
  );
}

export function WalkthroughCourse({ courseId, onNavigate }: WalkthroughCourseProps) {
  const course = COURSES_BY_ID[courseId];

  if (!course) {
    return (
      <main className="responsive-pad" style={{ maxWidth: 720, margin: '0 auto', paddingTop: 32 }}>
        <p style={{ fontSize: 14, color: T.muted, marginBottom: 16 }}>
          That course doesn't exist.
        </p>
        <button
          onClick={() => onNavigate({ name: 'home' })}
          className="btn-press chamfer"
          style={{
            background: T.ink,
            color: T.paper,
            border: 'none',
            padding: '10px 18px',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          ← Back home
        </button>
      </main>
    );
  }

  return (
    <main
      className="responsive-pad"
      style={{
        maxWidth: 960,
        margin: '0 auto',
        paddingTop: 24,
        paddingBottom: 96,
      }}
    >
      <button
        onClick={() => onNavigate({ name: 'home' })}
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
        ← Home
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
        {course.title}
      </h1>
      <p
        className="reveal reveal-2"
        style={{
          fontSize: 16,
          color: T.muted,
          lineHeight: 1.55,
          margin: '0 0 32px',
          maxWidth: 540,
        }}
      >
        {course.blurb}
      </p>

      <div
        className="stagger-children"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 12,
        }}
      >
        {course.topics.map((t) => (
          <TopicCard
            key={t.id}
            topic={t}
            onOpen={() => onNavigate({ name: 'topic', courseId: course.id, topicId: t.id })}
          />
        ))}
      </div>
    </main>
  );
}
