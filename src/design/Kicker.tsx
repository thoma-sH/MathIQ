import type { CSSProperties, ReactNode } from 'react';
import { T } from './tokens';

interface KickerProps {
  children: ReactNode;
  color?: string;
  style?: CSSProperties;
  className?: string;
}

/**
 * Small mono uppercase label — the editorial "kicker" used above headlines
 * and as section labels throughout the app.
 */
export function Kicker({ children, color, style, className }: KickerProps) {
  return (
    <div
      className={className}
      style={{
        fontFamily: T.mono,
        fontSize: 10,
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
        color: color ?? T.muted,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
