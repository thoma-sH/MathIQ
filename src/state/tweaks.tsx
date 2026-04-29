/**
 * User-tunable preferences ("tweaks"). Originally exposed as a designer's
 * floating panel in the prototype; now backed by real product settings
 * (see src/screens/Settings.tsx).
 *
 * Every run starts from defaults — no persistence — so the app behaves
 * like a fresh first-time experience on each load.
 *
 * Color theme, font stack, and density are applied via data-* attributes
 * on <html> so any component using CSS variables (see src/index.css and
 * src/design/tokens.ts) restyles without re-rendering.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export const COLOR_THEMES = ['warm', 'cool', 'acid', 'mono'] as const;
export const FONT_STACKS = ['editorial', 'technical', 'plain'] as const;
export const DENSITIES = ['compact', 'regular', 'comfy'] as const;
export const AI_TONES = ['encouraging', 'direct', 'witty', 'silent'] as const;
export const DIFFICULTY_VIEWS = ['adaptive', 'arithmetic', 'algebra', 'calculus', 'mixed'] as const;

export type ColorTheme = (typeof COLOR_THEMES)[number];
export type FontStack = (typeof FONT_STACKS)[number];
export type Density = (typeof DENSITIES)[number];
export type AiTone = (typeof AI_TONES)[number];
export type DifficultyView = (typeof DIFFICULTY_VIEWS)[number];

export interface Tweaks {
  colorTheme: ColorTheme;
  fontStack: FontStack;
  density: Density;
  aiTone: AiTone;
  drillTimer: number;
  difficultyView: DifficultyView;
}

export const DEFAULT_TWEAKS: Tweaks = {
  colorTheme: 'warm',
  fontStack: 'editorial',
  density: 'regular',
  aiTone: 'encouraging',
  drillTimer: 60,
  difficultyView: 'adaptive',
};

function syncToDocument(t: Tweaks) {
  const root = document.documentElement;
  root.setAttribute('data-theme', t.colorTheme);
  root.setAttribute('data-font', t.fontStack);
  root.setAttribute('data-density', t.density);
}

export interface TweaksContextValue {
  tweaks: Tweaks;
  setTweak: <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void;
  reset: () => void;
}

const Ctx = createContext<TweaksContextValue | null>(null);

export function TweaksProvider({ children }: { children: ReactNode }) {
  const [tweaks, setTweaks] = useState<Tweaks>(DEFAULT_TWEAKS);

  useEffect(() => {
    syncToDocument(tweaks);
  }, [tweaks]);

  const setTweak: TweaksContextValue['setTweak'] = (key, value) =>
    setTweaks((prev) => ({ ...prev, [key]: value }));

  const reset = () => setTweaks(DEFAULT_TWEAKS);

  return <Ctx.Provider value={{ tweaks, setTweak, reset }}>{children}</Ctx.Provider>;
}

export function useTweaks(): TweaksContextValue {
  const value = useContext(Ctx);
  if (!value) throw new Error('useTweaks must be used inside <TweaksProvider>');
  return value;
}
