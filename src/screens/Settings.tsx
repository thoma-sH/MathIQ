import {
  SignedIn,
  SignedOut,
  SignInButton,
  SignOutButton,
  useUser,
} from '@clerk/clerk-react';
import { T } from '../design/tokens';

export function Settings() {
  return (
    <main
      className="responsive-pad"
      style={{
        maxWidth: 720,
        margin: '0 auto',
        paddingTop: 32,
        paddingBottom: 96,
      }}
    >
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
        Settings
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
        Sign in to get 5 walkthroughs per day on the premium model.
      </p>

      <SignedIn>
        <AccountCard />
      </SignedIn>
      <SignedOut>
        <SignedOutCard />
      </SignedOut>
    </main>
  );
}

function AccountCard() {
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? '(no email on file)';

  return (
    <section
      className="reveal reveal-3"
      style={{
        padding: '24px 22px',
        border: `1px solid ${T.ink}`,
        background: T.paper2,
        marginBottom: 14,
      }}
    >
      <div style={kicker()}>SIGNED IN</div>
      <div style={{ fontSize: 19, fontWeight: 500, lineHeight: 1.35, marginBottom: 4 }}>
        {email}
      </div>
      <div style={{ fontSize: 13, color: T.muted, marginBottom: 16 }}>
        Free tier · 5 walkthroughs / day on Sonnet 4.6.
      </div>
      <SignOutButton>
        <button
          className="btn-press chamfer"
          style={{
            background: 'transparent',
            color: T.ink,
            border: `1px solid ${T.ink}`,
            padding: '9px 17px',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: T.sans,
          }}
        >
          Sign out
        </button>
      </SignOutButton>

      <div
        style={{
          marginTop: 20,
          paddingTop: 18,
          borderTop: `1px solid ${T.hair}`,
        }}
      >
        <div style={kicker()}>PRO UPGRADE</div>
        <div style={{ fontSize: 14, lineHeight: 1.5, marginTop: 6 }}>
          Coming soon — $7.99/mo for 50 walkthroughs/day on the premium model, unlimited saves, and exam-prep burst.
        </div>
      </div>
    </section>
  );
}

function SignedOutCard() {
  return (
    <section
      className="reveal reveal-3"
      style={{
        padding: '24px 22px',
        border: `1px solid ${T.ink}`,
        background: T.paper2,
        marginBottom: 14,
      }}
    >
      <div style={kicker()}>NOT SIGNED IN</div>
      <div style={{ fontSize: 19, fontWeight: 500, lineHeight: 1.35, marginBottom: 8 }}>
        You get 1 free walkthrough per day.
      </div>
      <div style={{ fontSize: 14, color: T.muted, lineHeight: 1.5, marginBottom: 16 }}>
        Sign in (email magic link, no password) to get 5 walkthroughs/day on the premium model.
      </div>
      <SignInButton mode="modal">
        <button
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
          Sign in
        </button>
      </SignInButton>
    </section>
  );
}

function kicker(): React.CSSProperties {
  return {
    fontFamily: T.mono,
    fontSize: 11,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: T.muted,
    marginBottom: 10,
  };
}
