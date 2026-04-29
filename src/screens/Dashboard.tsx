import { T } from '../design/tokens';
import { Kicker } from '../design/Kicker';
import type { Route } from '../router';
import type { SessionStats } from '../state/stats';

interface DashboardProps {
  onNavigate: (route: Route) => void;
  stats: SessionStats;
}

interface DashCardProps {
  title: string;
  sub: string;
  big: string;
  cta: string;
  onClick: () => void;
}

function DashCard({ title, sub, big, cta, onClick }: DashCardProps) {
  return (
    <button onClick={onClick} className="lift btn-press" style={{
      background: T.paper,
      border: `1px solid ${T.hair}`,
      padding: 24,
      position: 'relative',
      minHeight: 220,
      textAlign: 'left',
      cursor: 'pointer',
      display: 'block',
      fontFamily: 'inherit',
      color: 'inherit',
      borderRadius: 0,
    }}>
      <Kicker>{sub.split('·')[0]!.trim().toUpperCase()}</Kicker>
      <div style={{ fontSize: 22, fontFamily: T.serif, marginTop: 6, lineHeight: 1.15 }}>{title}</div>
      <div style={{ fontSize: 12, opacity: 0.55, marginTop: 6 }}>{sub}</div>
      <div style={{ position: 'absolute', right: 18, bottom: 14, fontSize: 56, fontFamily: T.serif, opacity: 0.5, lineHeight: 1 }}>{big}</div>
      <span style={{ position: 'absolute', bottom: 18, left: 24, fontSize: 13, fontWeight: 500, borderBottom: `1px solid ${T.ink}` }}>
        {cta.replace(/\s*→\s*$/, '')} <span className="arrow-nudge">→</span>
      </span>
    </button>
  );
}

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function Dashboard({ onNavigate, stats }: DashboardProps) {
  const hasActivity = stats.totalSolved > 0;

  return (
    <main
      className="grid-dashboard responsive-pad"
      style={{
        padding: '40px 36px',
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) 320px',
        gap: 36,
        maxWidth: 1440,
        margin: '0 auto',
      }}
    >
      <div>
        <Kicker className="reveal reveal-1" style={{ marginBottom: 8 }}>
          TODAY · GOAL {stats.solvedToday} / 50
        </Kicker>
        <h1 className="reveal reveal-2" style={{
          fontFamily: T.serif,
          fontSize: 'clamp(36px, 5vw, 64px)',
          lineHeight: 0.96,
          letterSpacing: '-0.03em',
          fontWeight: 400,
          margin: '0 0 32px',
          maxWidth: 740,
        }}>
          Welcome to MathIQ. <span style={{ opacity: 0.45 }}>Pick a drill to get started — five takes on mental math.</span>
        </h1>

        <div className="stagger-children" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 40 }}>
          <button
            onClick={() => onNavigate({ name: 'drill', mode: 'pulse', domain: 'mixed' })}
            className="lift btn-press"
            style={{
              background: T.ink,
              color: T.paper,
              padding: 28,
              position: 'relative',
              overflow: 'hidden',
              minHeight: 220,
              border: 'none',
              textAlign: 'left',
              cursor: 'pointer',
              display: 'block',
              borderRadius: 0,
              gridColumn: 'span 2',
            }}
          >
            <Kicker color="rgba(244,239,230,0.6)">START HERE · PULSE</Kicker>
            <div style={{ fontSize: 'clamp(24px, 3vw, 34px)', fontFamily: T.serif, marginTop: 8, lineHeight: 1.05 }}>
              Warm up with a mixed drill
            </div>
            <div style={{ fontSize: 13, opacity: 0.7, marginTop: 12, maxWidth: 320 }}>
              One problem at a time on a metronome. Arithmetic through calculus.
            </div>
            <span style={{
              position: 'absolute',
              bottom: 24,
              left: 28,
              background: T.accent,
              color: T.ink,
              padding: '10px 18px',
              fontSize: 14,
              fontWeight: 500,
            }}>
              Start drill <span className="arrow-nudge">→</span>
            </span>
            <div style={{ position: 'absolute', right: 24, bottom: 16, fontSize: 96, fontFamily: T.serif, opacity: 0.18, lineHeight: 1 }}>
              ×
            </div>
          </button>
          <DashCard
            onClick={() => onNavigate({ name: 'drill', mode: 'voice', domain: 'mixed' })}
            title="Voice with Iris" sub="Voice · hands-free" big="◉" cta="Speak →"
          />
          <DashCard
            onClick={() => onNavigate({ name: 'gallery' })}
            title="Browse all modes" sub="Gallery · live preview" big="◆" cta="Open →"
          />
        </div>

        <Kicker className="reveal reveal-3" style={{ marginBottom: 14 }}>CONTINUE</Kicker>
        <div className="reveal reveal-3" style={{ borderTop: `1px solid ${T.hair}`, padding: '24px 0 8px', textAlign: 'center', fontSize: 13, opacity: 0.55 }}>
          {hasActivity
            ? `${stats.totalSolved} problems solved across ${stats.sessionsToday} session${stats.sessionsToday === 1 ? '' : 's'} so far. Keep going.`
            : "No drills in progress yet — finish one and it'll show up here."}
        </div>
      </div>

      <aside>
        <Kicker className="reveal reveal-2" style={{ marginBottom: 14 }}>THIS WEEK</Kicker>
        <div className="reveal reveal-2" style={{ display: 'flex', gap: 4, marginBottom: 12, alignItems: 'flex-end', height: 80 }}>
          {DAYS.map((d, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: '100%',
                height: i === new Date().getDay() - 1 && hasActivity ? '40%' : '0%',
                background: T.accent,
                transition: 'height 600ms var(--ease-out-expo)',
                alignSelf: 'flex-end',
              }} />
              <div style={{ width: '100%', height: 1, background: T.hair }} />
              <span style={{ fontSize: 10, fontFamily: T.mono, opacity: 0.5 }}>{d}</span>
            </div>
          ))}
        </div>
        <div className="reveal reveal-2" style={{ fontSize: 12, opacity: 0.55, marginBottom: 28 }}>
          {hasActivity ? `${stats.solvedToday} solved today.` : 'No sessions yet this week.'}
        </div>

        <div className="reveal reveal-3" style={{ padding: 18, background: T.ink, color: T.paper }}>
          <Kicker color="rgba(244,239,230,0.6)">GETTING STARTED</Kicker>
          <div style={{ fontFamily: T.serif, fontSize: 18, marginTop: 6, lineHeight: 1.3 }}>
            Try a 60-second Pulse drill — Iris will start adapting after a few rounds.
          </div>
          <button
            onClick={() => onNavigate({ name: 'drill', mode: 'pulse', domain: 'mixed' })}
            className="btn-press"
            style={{
              marginTop: 10,
              background: 'transparent',
              border: '1px solid rgba(244,239,230,0.4)',
              color: T.paper,
              padding: '6px 12px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Begin <span className="arrow-nudge">→</span>
          </button>
        </div>
      </aside>
    </main>
  );
}
