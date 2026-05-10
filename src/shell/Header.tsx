import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/clerk-react';
import { T } from '../design/tokens';
import type { Route } from '../router';

interface HeaderProps {
  route: Route;
  onNavigate: (route: Route) => void;
}

export function Header({ route, onNavigate }: HeaderProps) {
  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 30,
        height: 64,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        borderBottom: `1px solid ${T.ink}`,
        background: T.paper,
      }}
    >
      <button
        onClick={() => onNavigate({ name: 'home' })}
        className="btn-press"
        aria-label="Home"
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          fontFamily: T.sans,
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          color: T.ink,
        }}
      >
        MathIQ
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={() => onNavigate({ name: 'settings' })}
          className="btn-press chamfer"
          aria-current={route.name === 'settings' ? 'page' : undefined}
          style={{
            background: route.name === 'settings' ? T.accent : T.ink,
            color: T.paper,
            border: 'none',
            padding: '8px 16px 9px',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Settings
        </button>
        <SignedOut>
          <SignInButton mode="modal">
            <button
              className="btn-press chamfer"
              style={{
                background: T.accent,
                color: T.paper,
                border: 'none',
                padding: '8px 16px 9px',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: T.sans,
              }}
            >
              Sign in
            </button>
          </SignInButton>
        </SignedOut>
        <SignedIn>
          <UserButton afterSignOutUrl="/" />
        </SignedIn>
      </div>
    </header>
  );
}
