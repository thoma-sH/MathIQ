/**
 * The theme catalog.
 *
 * Metadata only — every palette's actual colors live in `src/index.css` as a
 * `[data-theme='…']` block. That split is deliberate: the CSS blocks are
 * unscoped attribute selectors, so a swatch card carrying `data-theme` renders
 * a live preview from the real tokens. Duplicating hex into TypeScript would
 * give us a second source of truth that silently drifts from the first.
 *
 * Every palette authors the same seven slots: base, surface, border, text,
 * muted, accent, deep. Adding a theme means one CSS block plus one entry here.
 */
export type ThemeId =
  | 'pistachio'
  | 'parchment'
  | 'chalk'
  | 'clay'
  | 'warm-brown'
  | 'soft-sage'
  | 'deep-swamp'
  | 'khaki-field'
  | 'tightened-drab'
  | 'moss-and-gold';

/** Display order within each group, left to right. */
export const LIGHT_THEMES: ThemeId[] = ['pistachio', 'parchment', 'chalk', 'clay'];

export const DARK_THEMES: ThemeId[] = [
  'warm-brown',
  'soft-sage',
  'deep-swamp',
  'khaki-field',
  'tightened-drab',
  'moss-and-gold',
];

export const THEME_IDS: ThemeId[] = [...LIGHT_THEMES, ...DARK_THEMES];

/** The pistachio is the identity, so it stays what a new student lands on. */
export const DEFAULT_LIGHT: ThemeId = 'pistachio';
export const DEFAULT_DARK: ThemeId = 'warm-brown';

export const THEME_LABEL: Record<ThemeId, string> = {
  pistachio: 'Pistachio',
  parchment: 'Parchment',
  chalk: 'Chalk',
  clay: 'Clay',
  'warm-brown': 'Warm brown',
  'soft-sage': 'Soft sage',
  'deep-swamp': 'Deep swamp',
  'khaki-field': 'Khaki field',
  'tightened-drab': 'Tightened drab',
  'moss-and-gold': 'Moss and gold',
};

/**
 * The color the browser chrome and iOS status bar take. This is the one place
 * a palette's hex has to be repeated, because `<meta name="theme-color">` is
 * not a CSS surface and cannot read a custom property. Keep in sync with each
 * block's `--paper` in index.css.
 */
export const THEME_CHROME: Record<ThemeId, string> = {
  pistachio: '#d4e26a',
  parchment: '#efe7d3',
  chalk: '#f5f6f4',
  clay: '#f2e4dc',
  'warm-brown': '#1d2021',
  'soft-sage': '#272e33',
  'deep-swamp': '#10160f',
  'khaki-field': '#1f2019',
  'tightened-drab': '#1e2415',
  'moss-and-gold': '#191c13',
};

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as string[]).includes(value);
}
