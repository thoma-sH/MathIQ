import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/clerk-react';
import { T } from '../design/tokens';
import type { Route } from '../router';

interface HeaderProps {
  route: Route;
  onNavigate: (route: Route) => void;
}

export function Header({ route, onNavigate }: HeaderProps) {
  const showBack = route.name !== 'home';
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {showBack && (
          <button
            onClick={() => window.history.back()}
            className="btn-press"
            aria-label="Back"
            style={{
              background: 'transparent',
              border: 'none',
              padding: '6px 8px',
              marginLeft: -12,
              minWidth: 44,
              minHeight: 44,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontFamily: T.sans,
              fontSize: 22,
              lineHeight: 1,
              color: T.ink,
            }}
          >
            ←
          </button>
        )}
        <button
          onClick={() => onNavigate({ name: 'home' })}
          className="btn-press"
          aria-label="Home"
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            minHeight: 44,
            display: 'inline-flex',
            alignItems: 'center',
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
      </div>
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
            minHeight: 44,
            display: 'inline-flex',
            alignItems: 'center',
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
                minHeight: 44,
                display: 'inline-flex',
                alignItems: 'center',
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
          <UserButton
            appearance={{
              variables: {
                colorPrimary: T.ink,
                colorBackground: T.paper,
                colorText: T.ink,
                colorTextOnPrimaryBackground: T.paper,
                colorInputBackground: T.paper,
                colorInputText: T.ink,
                fontFamily: '"DM Sans", sans-serif',
                borderRadius: '0',
              },
              elements: {
                userButtonAvatarBox: {
                  width: 36,
                  height: 36,
                  border: `1px solid ${T.ink}`,
                  boxShadow: 'none',
                },
                userButtonPopoverCard: {
                  background: T.paper,
                  border: `1px solid ${T.ink}`,
                  borderRadius: 0,
                  boxShadow: `0 4px 16px ${T.shadow}`,
                },
                userButtonPopoverActionButton: { color: T.ink },
                userButtonPopoverActionButtonText: { color: T.ink },
                userButtonPopoverFooter: { background: T.paper, borderTop: `1px solid ${T.hair}` },
                avatarImage: { borderRadius: '50%' },
              },
            }}
          />
        </SignedIn>
      </div>
    </header>
  );
}
