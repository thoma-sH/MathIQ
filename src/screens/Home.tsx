import { T } from '../design/tokens';
import { COURSES } from '../walkthroughs/courses';
import type { Route } from '../router';

interface HomeProps {
  onNavigate: (route: Route) => void;
}

interface CourseCardProps {
  title: string;
  blurb: string;
  onClick: () => void;
}

function CourseCard({ title, blurb, onClick }: CourseCardProps) {
  return (
    <button
      onClick={onClick}
      className="lift btn-press"
      style={{
        background: 'transparent',
        border: `1px solid ${T.ink}`,
        padding: '20px 22px 18px',
        textAlign: 'left',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        fontFamily: 'inherit',
        color: T.ink,
        borderRadius: 0,
        width: '100%',
        position: 'relative',
        minHeight: 120,
      }}
    >
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          lineHeight: 1.15,
          letterSpacing: '-0.01em',
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 14, color: T.muted, lineHeight: 1.4 }}>
        {blurb}
      </div>
      <span
        className="arrow-nudge"
        aria-hidden
        style={{
          position: 'absolute',
          right: 18,
          bottom: 14,
          fontSize: 22,
          color: T.ink,
        }}
      >
        →
      </span>
    </button>
  );
}

export function Home({ onNavigate }: HomeProps) {
  return (
    <main
      className="responsive-pad"
      style={{
        maxWidth: 960,
        margin: '0 auto',
        paddingTop: 32,
        paddingBottom: 96,
      }}
    >
      <h1
        className="reveal reveal-1"
        style={{
          fontFamily: T.sans,
          fontSize: 'clamp(36px, 8vw, 64px)',
          fontWeight: 700,
          lineHeight: 1.0,
          letterSpacing: '-0.025em',
          margin: '8px 0 16px',
          maxWidth: 16 * 38,
        }}
      >
        What would you like to learn today?
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
        Pick a course. Type a problem. Get walked through it step by step — and pick up the neat tricks along the way.
      </p>

      <div
        className="stagger-children"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 12,
        }}
      >
        {COURSES.map((c) => (
          <CourseCard
            key={c.id}
            title={c.title}
            blurb={c.blurb}
            onClick={() => onNavigate({ name: 'walkthrough', courseId: c.id })}
          />
        ))}
      </div>
    </main>
  );
}
