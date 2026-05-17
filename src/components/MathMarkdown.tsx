import { createElement, memo, type CSSProperties, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { MarkdownBoundary } from './MarkdownBoundary';

// Module-scope plugin arrays. Inline `[remarkMath]` allocates a new array
// every render, which busts ReactMarkdown's internal memoization and
// re-parses every keystroke / streaming chunk.
const REMARK_PLUGINS = [remarkMath];
const REHYPE_PLUGINS = [rehypeKatex];

// Stable components override for inline rendering — strips the outer <p>
// wrapper so the result flows inside a parent text node.
export const INLINE_COMPONENTS: Components = {
  p: ({ children }: { children?: ReactNode }) => <>{children}</>,
};

interface Props {
  children: string;
  className?: string;
  style?: CSSProperties;
  components?: Components;
  /** Wrapper element. Use 'span' inside inline contexts to keep HTML valid. */
  as?: 'div' | 'span';
  id?: string;
}

// Wraps ReactMarkdown + remark-math + rehype-katex behind one component so
// (a) the plugin arrays are stable references, (b) errors from rehype-katex
// on malformed LaTeX show the raw source instead of unmounting the tree,
// and (c) re-renders with the same string are free thanks to React.memo.
export const MathMarkdown = memo(function MathMarkdown({
  children,
  className,
  style,
  components,
  as = 'div',
  id,
}: Props) {
  return (
    <MarkdownBoundary fallback={children}>
      {createElement(
        as,
        { className, style, id },
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          rehypePlugins={REHYPE_PLUGINS}
          components={components}
        >
          {children}
        </ReactMarkdown>,
      )}
    </MarkdownBoundary>
  );
});
