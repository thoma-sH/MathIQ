import type { CSSProperties } from 'react';
import { T } from './tokens';

export const primaryBtn = (color: string = T.ink, fg: string = T.paper): CSSProperties => ({
  padding: '10px 18px',
  border: 'none',
  background: color,
  color: fg,
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
});

export const ghostBtn = (color: string = T.ink): CSSProperties => ({
  padding: '10px 16px',
  border: `1px solid ${color}`,
  background: 'transparent',
  color: T.ink,
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
});

export const chipBtn = (active: boolean): CSSProperties => ({
  padding: '8px 14px',
  border: `1px solid ${T.ink}`,
  background: active ? T.ink : 'transparent',
  color: active ? T.paper : T.ink,
  fontSize: 12,
  fontFamily: T.mono,
  cursor: 'pointer',
});
