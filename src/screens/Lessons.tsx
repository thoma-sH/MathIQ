import { useMemo } from 'react';
import { T } from '../design/tokens';
import { COURSES } from '../walkthroughs/courses';
import { getDailyContent } from '../state/dailyScribe';
import { useTypedString } from '../state/useTypedString';
import type { Route } from '../router';

interface LessonsProps {
  onNavigate: (route: Route) => void;
}

interface CourseCardProps {
  title: string;
  blurb: string;
  onClick: () => void;
}

function ScribeMark({ src }: { src: string }) {
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      style={{
        height: 'clamp(120px, 18vw, 180px)',
        width: 'auto',
        maxWidth: '100%',
        display: 'block',
        flexShrink: 0,
      }}
    />
  );
}

function CourseCard({ title, blurb, onClick }: CourseCardProps) {
  return (
    <button
      onClick={onClick}
      className="lift btn-press course-card"
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
        className="card-title"
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

export function Lessons({ onNavigate }: LessonsProps) {
  const { dayLabel, tagline, scribeSrc } = useMemo(() => getDailyContent(), []);
  const typedLabel = useTypedString(dayLabel, 40, 180);

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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'clamp(24px, 5vw, 56px)',
          flexWrap: 'wrap',
          marginBottom: 64,
        }}
      >
        <div style={{ flex: '3 1 320px', minWidth: 0 }}>
          <div
            className="reveal reveal-1"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginBottom: 18,
            }}
          >
            <span
              style={{
                fontFamily: T.mono,
                fontSize: 11,
                letterSpacing: '0.22em',
                color: T.ink,
                textTransform: 'uppercase',
                whiteSpace: 'pre',
              }}
              aria-label={dayLabel}
            >
              {typedLabel}
              {typedLabel.length < dayLabel.length && <span className="type-caret" aria-hidden />}
            </span>
            <span
              aria-hidden
              style={{
                flex: 1,
                height: 1,
                background: T.ink,
                maxWidth: 240,
              }}
            />
          </div>

          <h1
            className="reveal reveal-2"
            style={{
              fontFamily: T.sans,
              fontSize: 'clamp(36px, 8vw, 64px)',
              fontWeight: 700,
              lineHeight: 1.0,
              letterSpacing: '-0.025em',
              margin: '0 0 18px',
              maxWidth: 16 * 38,
            }}
          >
            Lessons.
          </h1>

          <p
            className="reveal reveal-3"
            style={{
              fontSize: 19,
              color: T.ink,
              lineHeight: 1.55,
              margin: 0,
              maxWidth: 620,
              fontWeight: 600,
            }}
          >
            {tagline}
          </p>
        </div>

        <div
          className="reveal reveal-2"
          style={{
            flex: '2 1 200px',
            display: 'flex',
            justifyContent: 'flex-end',
            paddingRight: 'clamp(0px, 3vw, 32px)',
          }}
        >
          <ScribeMark src={scribeSrc} />
        </div>
      </div>

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
