/**
 * Which palette the app is wearing.
 *
 * Three stored values rather than one, because with both light and dark
 * palettes on offer "follow my device" has to know *which* light and *which*
 * dark to switch between:
 *
 *   themeMode   'auto' | 'light' | 'dark'   — auto defers to the OS
 *   themeLight  the palette used in daylight
 *   themeDark   the palette used at night
 *
 * Tapping a swatch sets that group's palette; if the mode is pinned it also
 * pins to that group, so a tap always visibly does something.
 *
 * A matching pre-paint script in index.html resolves the same three values
 * before React mounts. Without it the default palette flashes on every load,
 * which is worst on exactly the dark themes someone chose to avoid glare.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  KEY_THEME_DARK,
  KEY_THEME_LIGHT,
  KEY_THEME_MODE,
  readString,
  writeString,
} from '../lib/storage';
import {
  DEFAULT_DARK,
  DEFAULT_LIGHT,
  THEME_CHROME,
  isThemeId,
  type ThemeId,
} from '../design/palettes';

export type ThemeMode = 'auto' | 'light' | 'dark';

export interface ThemeState {
  mode: ThemeMode;
  light: ThemeId;
  dark: ThemeId;
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

// Unset defaults to 'light', not 'auto': a new student should land on
// pistachio whatever their phone is set to, since pistachio is the identity.
function readMode(): ThemeMode {
  const raw = readString(KEY_THEME_MODE);
  return raw === 'auto' || raw === 'dark' ? raw : 'light';
}

function readSide(key: string, fallback: ThemeId): ThemeId {
  const raw = readString(key);
  return isThemeId(raw) ? raw : fallback;
}

export function getThemeState(): ThemeState {
  return {
    mode: readMode(),
    light: readSide(KEY_THEME_LIGHT, DEFAULT_LIGHT),
    dark: readSide(KEY_THEME_DARK, DEFAULT_DARK),
  };
}

function prefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(DARK_QUERY).matches;
}

/** The palette actually in force right now. */
export function resolveTheme(state: ThemeState = getThemeState()): ThemeId {
  if (state.mode === 'light') return state.light;
  if (state.mode === 'dark') return state.dark;
  return prefersDark() ? state.dark : state.light;
}

/** Reflect a palette onto the document. Also called from the boot path. */
export function applyTheme(id: ThemeId): void {
  document.documentElement.setAttribute('data-theme', id);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_CHROME[id]);
}

export function useTheme() {
  const [state, setState] = useState<ThemeState>(getThemeState);

  // In 'auto' the OS can change the answer without the app doing anything, so
  // the effect has to listen. Pinned modes have nothing to listen for.
  useEffect(() => {
    applyTheme(resolveTheme(state));
    if (state.mode !== 'auto' || !window.matchMedia) return;
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => applyTheme(resolveTheme(state));
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [state]);

  const setMode = useCallback((mode: ThemeMode) => {
    writeString(KEY_THEME_MODE, mode);
    setState((prev) => ({ ...prev, mode }));
  }, []);

  // Picking a palette from a group also pins to that group unless the student
  // has asked to follow the device — otherwise tapping a dark swatch in
  // daylight would appear to do nothing at all.
  const setPalette = useCallback((id: ThemeId, group: 'light' | 'dark') => {
    const key = group === 'dark' ? KEY_THEME_DARK : KEY_THEME_LIGHT;
    writeString(key, id);
    setState((prev) => {
      const next: ThemeState = { ...prev, [group]: id };
      if (prev.mode !== 'auto' && prev.mode !== group) {
        writeString(KEY_THEME_MODE, group);
        next.mode = group;
      }
      return next;
    });
  }, []);

  return { state, active: resolveTheme(state), setMode, setPalette };
}
