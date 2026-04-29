/**
 * Design tokens — references CSS custom properties so themes apply at the
 * document root (see src/index.css and TweaksContext). Components import
 * `T` and use it inline (`background: T.paper`) without knowing about the
 * underlying var indirection.
 */
export const T = {
  ink: 'var(--ink)',
  paper: 'var(--paper)',
  paper2: 'var(--paper-2)',
  accent: 'var(--accent)',
  accent2: 'var(--accent-2)',
  accent3: 'var(--accent-3)',
  accent4: 'var(--accent-4)',
  accentYou: 'var(--accent-you)',
  accentAi: 'var(--accent-ai)',
  hair: 'var(--hair)',
  hairStrong: 'var(--hair-strong)',
  muted: 'var(--muted)',
  serif: 'var(--font-serif)',
  slab: 'var(--font-slab)',
  sans: 'var(--font-sans)',
  mono: 'var(--font-mono)',
} as const;

export type Tokens = typeof T;
