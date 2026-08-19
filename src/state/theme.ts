/**
 * Light / dark appearance.
 *
 * Three states, not two: 'system' is the default and defers to the OS, so a
 * student who never opens Settings still gets dark at night. Choosing light or
 * dark explicitly pins it — a stated preference outranks the OS.
 *
 * The pinned states write `data-theme` on <html>; 'system' removes the
 * attribute entirely and lets the `prefers-color-scheme` block in index.css
 * decide. That keeps the CSS the single source of truth for what each theme
 * looks like — this module only ever says *which* one applies.
 *
 * A matching pre-paint script in index.html applies the stored choice before
 * first paint. Without it the pistachio light body flashes before React
 * mounts, which is worse at night than no dark mode at all.
 */
import { useEffect, useState } from 'react';
import { KEY_THEME, readString, writeString } from '../lib/storage';

export type Theme = 'system' | 'light' | 'dark';

function read(): Theme {
  const stored = readString(KEY_THEME);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

/** Reflect a theme onto <html>. Exported for the boot path in main.tsx. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function getTheme(): Theme {
  return read();
}

export function useTheme(): [Theme, (next: Theme) => void] {
  const [value, setValue] = useState<Theme>(read);

  // The browser theme-color (address bar, PWA splash) isn't a CSS variable, so
  // it can't ride the token swap — it has to be set imperatively whenever the
  // effective theme changes, including when the OS flips under 'system'.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => {
      const dark = value === 'dark' || (value === 'system' && media.matches);
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', dark ? '#161f0e' : '#d4e26a');
    };
    sync();
    if (value !== 'system') return;
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [value]);

  function update(next: Theme) {
    writeString(KEY_THEME, next);
    applyTheme(next);
    setValue(next);
  }

  return [value, update];
}
