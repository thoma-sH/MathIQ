import { Component, type ReactNode } from 'react';
import { T } from '../design/tokens';
import { kicker } from '../design/primitives';

interface State {
  failed: boolean;
}

// The last boundary above the whole tree. Without one, anything thrown during
// a render or a mount effect — a browser missing an API, a snapshot in a
// shape we no longer read — unmounts everything and leaves a blank page with
// no way forward. MarkdownBoundary covers one renderer; this covers the app.
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="responsive-pad" style={{ maxWidth: 560, margin: '40px auto' }}>
        <div
          role="alert"
          style={{
            border: `1px solid ${T.ink}`,
            background: T.paper2,
            padding: '24px 22px',
          }}
        >
          <div style={kicker()}>SOMETHING WENT WRONG</div>
          <p style={{ margin: '8px 0 18px', fontSize: 16, lineHeight: 1.5, color: T.ink }}>
            MathIQ hit an error it couldn't recover from. Reloading the page usually
            fixes it.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="btn-press chamfer"
              style={{
                background: T.accent,
                color: T.paper,
                border: 'none',
                padding: '12px 20px',
                minHeight: 44,
                fontSize: 15,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: T.sans,
              }}
            >
              Reload
            </button>
            <a
              href="/"
              className="btn-press"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 44,
                padding: '0 6px',
                fontFamily: T.mono,
                fontSize: 12,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: T.muted,
                textDecoration: 'underline',
              }}
            >
              Go home
            </a>
          </div>
        </div>
      </main>
    );
  }
}
