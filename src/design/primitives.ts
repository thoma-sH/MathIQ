import type { CSSProperties } from 'react';
import { T } from './tokens';

// Small uppercase mono label used above sections, cards, and breadcrumbs.
// `mb` lets callers tighten/loosen the gap to the element below.
export function kicker(mb: number = 6): CSSProperties {
  return {
    fontFamily: T.mono,
    fontSize: 11,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: T.muted,
    marginBottom: mb,
  };
}

// Transparent back-link button styled to match the kicker rhythm.
export function breadcrumb(): CSSProperties {
  return {
    background: 'transparent',
    border: 'none',
    padding: 0,
    fontSize: 13,
    fontFamily: T.mono,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: T.muted,
    cursor: 'pointer',
    marginBottom: 16,
  };
}
