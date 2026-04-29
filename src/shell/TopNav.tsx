import { T } from '../design/tokens';
import type { Route } from '../router';

interface TopNavProps {
  route: Route;
  onNavigate: (route: Route) => void;
  streak: number;
}

const TABS: { id: Route['name']; label: string }[] = [
  { id: 'home', label: 'Today' },
  { id: 'drills', label: 'Drills' },
  { id: 'gallery', label: 'Gallery' },
  { id: 'tutor', label: 'Tutor' },
  { id: 'library', label: 'Library' },
  { id: 'profile', label: 'Stats' },
];

export function TopNav({ route, onNavigate, streak }: TopNavProps) {
  return (
    <header
      className="responsive-tight"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '18px 36px',
        borderBottom: `1px solid ${T.hair}`,
        background: T.paper,
        position: 'sticky',
        top: 0,
        zIndex: 20,
        backdropFilter: 'saturate(140%) blur(8px)',
        WebkitBackdropFilter: 'saturate(140%) blur(8px)',
        gap: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 36, minWidth: 0 }}>
        <a
          onClick={() => onNavigate({ name: 'home' })}
          style={{
            fontFamily: T.serif,
            fontSize: 26,
            letterSpacing: '-0.02em',
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          MathIQ
        </a>
        <nav
          className="top-nav-tabs"
          style={{ display: 'flex', gap: 24, minWidth: 0 }}
        >
          {TABS.map((t) => (
            <a
              key={t.id}
              onClick={() => onNavigate({ name: t.id } as Route)}
              className={`nav-link${route.name === t.id ? ' is-active' : ''}`}
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: route.name === t.id ? T.ink : T.muted,
                whiteSpace: 'nowrap',
              }}
            >
              {t.label}
            </a>
          ))}
        </nav>
      </div>
      <div className="top-nav-actions" style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
        <button
          onClick={() => onNavigate({ name: 'settings' })}
          aria-label="Settings"
          className="btn-press actions-collapse"
          style={{
            background: 'transparent',
            border: `1px solid ${T.hair}`,
            padding: '6px 10px',
            fontFamily: T.mono,
            fontSize: 11,
            letterSpacing: '0.15em',
            cursor: 'pointer',
          }}
        >
          ⚙ TWEAKS
        </button>
        <span
          className="actions-collapse"
          style={{
            fontFamily: T.mono,
            fontSize: 11,
            letterSpacing: '0.15em',
            padding: '6px 12px',
            background: T.ink,
            color: T.paper,
          }}
        >
          STREAK · {String(streak).padStart(3, '0')}
        </span>
        <div
          aria-label="Profile"
          onClick={() => onNavigate({ name: 'profile' })}
          className="btn-press"
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            background: 'transparent',
            border: `1.5px solid ${T.ink}`,
            cursor: 'pointer',
          }}
        />
      </div>
    </header>
  );
}
