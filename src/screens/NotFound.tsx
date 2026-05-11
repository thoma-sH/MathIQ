import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { T } from '../design/tokens';
import type { Route } from '../router';

interface NotFoundProps {
  message?: string;
  onNavigate: (route: Route) => void;
}

export function NotFound({ message, onNavigate }: NotFoundProps) {
  return (
    <main
      className="responsive-pad"
      style={{
        maxWidth: 720,
        margin: '0 auto',
        paddingTop: 80,
        paddingBottom: 96,
      }}
    >
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
          }}
        >
          404
        </span>
        <span
          aria-hidden
          style={{
            flex: 1,
            height: 1,
            background: T.ink,
            maxWidth: 120,
          }}
        />
      </div>

      <h1
        className="reveal reveal-2"
        style={{
          fontFamily: T.sans,
          fontSize: 'clamp(32px, 6vw, 48px)',
          fontWeight: 700,
          lineHeight: 1.05,
          letterSpacing: '-0.025em',
          margin: '0 0 14px',
        }}
      >
        We checked every basis vector.
      </h1>

      <p
        className="reveal reveal-3 markdown-body"
        style={{
          fontSize: 17,
          color: T.ink,
          lineHeight: 1.55,
          margin: '0 0 8px',
          maxWidth: 560,
          fontWeight: 500,
        }}
      >
        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
          {'This page isn\'t in the span.'}
        </ReactMarkdown>
      </p>

      <p
        className="reveal reveal-4"
        style={{
          fontSize: 14,
          color: T.muted,
          lineHeight: 1.6,
          margin: '0 0 32px',
          maxWidth: 560,
        }}
      >
        {message ?? 'Whatever you were looking for, the home page still exists.'}
      </p>

      <button
        onClick={() => onNavigate({ name: 'home' })}
        className="btn-press chamfer reveal reveal-5"
        style={{
          background: T.accent,
          color: T.paper,
          border: 'none',
          padding: '12px 20px',
          fontSize: 15,
          fontWeight: 500,
          cursor: 'pointer',
          fontFamily: T.sans,
        }}
      >
        ← Back home
      </button>
    </main>
  );
}
