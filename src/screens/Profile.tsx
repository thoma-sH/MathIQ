import { T } from '../design/tokens';
import { Kicker } from '../design/Kicker';
import type { SessionStats } from '../state/stats';

interface ProfileProps {
  stats: SessionStats;
}

interface BadgeDef {
  glyph: string;
  label: string;
  /** Predicate: given session stats, has the user earned this badge? */
  earned: (s: SessionStats) => boolean;
}

const BADGES: BadgeDef[] = [
  { glyph: '◆', label: 'First solve',      earned: (s) => s.totalSolved >= 1 },
  { glyph: '▲', label: '10 solved',         earned: (s) => s.totalSolved >= 10 },
  { glyph: '●', label: '50 solved',         earned: (s) => s.totalSolved >= 50 },
  { glyph: '◇', label: '5-streak',          earned: (s) => s.streakBest >= 5 },
  { glyph: '☐', label: '10-streak',         earned: (s) => s.streakBest >= 10 },
  { glyph: '✦', label: 'Half-second',       earned: (s) => s.fastestAnswerSec != null && s.fastestAnswerSec < 0.5 },
  { glyph: '◑', label: 'Sub-second',        earned: (s) => s.fastestAnswerSec != null && s.fastestAnswerSec < 1 },
  { glyph: '◐', label: 'Two sessions',      earned: (s) => s.sessionsToday >= 2 },
  { glyph: '☆', label: 'Beat the AI',       earned: (s) => s.arenaWins >= 1 },
  { glyph: '⬢', label: 'Champion',          earned: (s) => s.arenaWins >= 3 },
];

const fmtSec = (s: number | null) => (s == null ? '—' : `${s.toFixed(2)}s`);

export function Profile({ stats }: ProfileProps) {
  const earnedCount = BADGES.filter((b) => b.earned(stats)).length;

  const records: Array<[label: string, value: string, sub: string]> = [
    ['Fastest answer',   fmtSec(stats.fastestAnswerSec),                  stats.fastestProblem ?? 'no sessions yet'],
    ['Longest streak',   stats.streakBest > 0 ? String(stats.streakBest) : '—', stats.streakBest > 0 ? 'this session' : 'no sessions yet'],
    ['Solved today',     String(stats.solvedToday),                       'session count'],
    ['Total solved',     String(stats.totalSolved),                       'this run'],
    ['Sessions today',   String(stats.sessionsToday),                     'this run'],
    ['Arena W / L',      `${stats.arenaWins} / ${stats.arenaLosses}`,     stats.arenaWins + stats.arenaLosses === 0 ? 'no matches yet' : 'vs HAIKU.7'],
  ];

  return (
    <main
      className="grid-profile responsive-pad"
      style={{
        padding: '40px 36px',
        display: 'grid',
        gridTemplateColumns: '1fr 1.2fr',
        gap: 56,
        maxWidth: 1440,
        margin: '0 auto',
      }}
    >
      <div>
        <Kicker className="reveal reveal-1">MEMBER · DAY 1</Kicker>
        <h1 className="reveal reveal-2" style={{
          fontFamily: T.serif,
          fontSize: 'clamp(48px, 7vw, 84px)',
          lineHeight: 0.92,
          letterSpacing: '-0.03em',
          fontWeight: 400,
          margin: '14px 0',
        }}>
          Your<br />profile
        </h1>
        <div className="reveal reveal-3" style={{ fontSize: 16, opacity: 0.7, maxWidth: 380, lineHeight: 1.4 }}>
          {stats.totalSolved === 0
            ? 'Train daily and your records, badges, and streak grid will fill in here.'
            : `Nice — ${stats.totalSolved} solved across ${stats.sessionsToday} session${stats.sessionsToday === 1 ? '' : 's'}. Keep going.`}
        </div>

        <Kicker className="reveal reveal-4" style={{ marginTop: 36, marginBottom: 14 }}>
          STREAK · {stats.streak} DAYS
        </Kicker>
        <div className="reveal reveal-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(20, 1fr)', gap: 3, maxWidth: 380 }}>
          {Array.from({ length: 100 }, (_, i) => (
            <div key={i} style={{
              aspectRatio: '1',
              background: i < stats.streak ? T.ink : T.hair,
            }} />
          ))}
        </div>
      </div>

      <div>
        <Kicker className="reveal reveal-2" style={{ marginBottom: 14 }}>
          BADGES · {earnedCount} / {BADGES.length}
        </Kicker>
        <div className="stagger-children" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 36 }}>
          {BADGES.map((b, i) => {
            const earned = b.earned(stats);
            return (
              <div key={i} style={{
                aspectRatio: '1',
                border: `1px solid ${earned ? T.ink : T.hair}`,
                padding: 12,
                opacity: earned ? 1 : 0.25,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                background: earned ? T.paper2 : 'transparent',
                transition: 'all 320ms var(--ease-out-expo)',
              }}>
                <div style={{ fontSize: 24 }}>{b.glyph}</div>
                <div style={{ fontSize: 10, fontFamily: T.mono, letterSpacing: '0.05em' }}>{b.label}</div>
              </div>
            );
          })}
        </div>

        <Kicker className="reveal reveal-3" style={{ marginBottom: 14 }}>RECORDS</Kicker>
        <div className="stagger-children" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
          {records.map(([l, v, sub], i) => (
            <div key={i} style={{ padding: '14px 0', borderTop: `1px solid ${T.hair}` }}>
              <Kicker style={{ letterSpacing: '0.15em' }}>{l}</Kicker>
              <div style={{
                fontFamily: T.serif,
                fontSize: 28,
                marginTop: 4,
                opacity: v === '—' ? 0.4 : 1,
              }}>{v}</div>
              <div style={{ fontSize: 11, opacity: 0.55 }}>{sub}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
