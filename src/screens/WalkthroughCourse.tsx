import { useAuth } from '@clerk/clerk-react';
import { T } from '../design/tokens';
import { COURSES_BY_ID } from '../walkthroughs/courses';
import { NotFound } from './NotFound';
import { fetchSubscriptionState } from '../billing/client';
import { isPro } from '../walkthroughs/tier';
import { useUpgradePrompt } from '../upgrade/UpgradePrompt';
import { MathMarkdown } from '../components/MathMarkdown';
import { useAsync } from '../hooks/useAsync';
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
      aria-label={`Open ${topic.title}`}
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
      <MathMarkdown
        className="markdown-body"
        style={{ fontSize: 13, color: T.muted, lineHeight: 1.4 }}
      >
        {topic.blurb}
      </MathMarkdown>
      <MathMarkdown
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
        {topic.exampleProblem}
      </MathMarkdown>
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
  const { getToken } = useAuth();
  const { requireUpgrade } = useUpgradePrompt();
  const subAsync = useAsync(() => fetchSubscriptionState({ getToken }), [getToken]);
  const tier = subAsync.data?.tier ?? null;

  if (!course) {
    return (
      <NotFound
        message="That course doesn't exist — it may have been renamed or removed."
        onNavigate={onNavigate}
      />
    );
  }

  function onExamsClick() {
    if (!isPro(tier)) {
      requireUpgrade('exam-mode');
      return;
    }
    onNavigate({ name: 'exams', courseId: course!.id });
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
        onClick={() => onNavigate({ name: 'subjects' })}
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
        ← Subjects
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
          margin: '0 0 24px',
          maxWidth: 540,
        }}
      >
        {course.blurb}
      </p>

      <button
        onClick={onExamsClick}
        className="lift btn-press"
        aria-label={`Open ${course.title} exam mode`}
        style={{
          background: T.accent,
          border: `1px solid ${T.ink}`,
          color: T.paper,
          padding: '16px 22px',
          fontSize: 15,
          fontWeight: 600,
          fontFamily: T.sans,
          cursor: 'pointer',
          width: '100%',
          marginBottom: 24,
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Exam mode</span>
          <span style={{ fontSize: 12, opacity: 0.75, fontWeight: 400, fontFamily: T.mono, letterSpacing: '0.1em' }}>
            4 EXAMS · GENERATED + GRADED · PRO
          </span>
        </span>
        <span aria-hidden style={{ fontSize: 18 }}>→</span>
      </button>

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
