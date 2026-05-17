import { Component, type ReactNode } from 'react';
import { T } from '../design/tokens';

interface Props {
  /** Raw source — shown verbatim if rendering throws. */
  fallback: string;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

// Wraps ReactMarkdown so a malformed LaTeX block (unclosed `$$`, bad macro)
// can't blank the screen. On error we surface the raw source so the user
// still sees the content, just unrendered.
export class MarkdownBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.failed && prevProps.fallback !== this.props.fallback) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div>
        <div
          style={{
            fontFamily: T.mono,
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: T.muted,
            marginBottom: 6,
          }}
        >
          RENDERING ERROR — RAW BELOW
        </div>
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: T.mono,
            fontSize: 13,
            lineHeight: 1.5,
            margin: 0,
          }}
        >
          {this.props.fallback}
        </pre>
      </div>
    );
  }
}
