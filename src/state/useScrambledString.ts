import { useLayoutEffect, useState } from 'react';

/**
 * Decodes `target` left to right: every character past the lock point flips
 * through random glyphs until the lock reaches it.
 *
 * The charset is ASCII-only on purpose. Callers render this in a monospace
 * face, where every ASCII glyph is one cell wide, so the text churns in place
 * instead of reflowing on each frame. Spaces and newlines pass through
 * unscrambled for the same reason — word shape and line count hold steady
 * while the characters move.
 *
 * Honors `prefers-reduced-motion`, and `enabled: false`, by settling instantly
 * without ever starting a frame loop.
 */
const GLYPHS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-*/=^_(){}[]\$<>|~#@%&';

/** Long problems shouldn't drag; short ones still need enough frames to read
 *  as a decode rather than a flicker. */
function durationFor(length: number): number {
  return Math.min(900, 300 + length * 6);
}

function scramble(target: string, locked: number): string {
  let out = target.slice(0, locked);
  for (let i = locked; i < target.length; i++) {
    const ch = target[i];
    out += ch === ' ' || ch === '\n' ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0];
  }
  return out;
}

export interface Scrambled {
  text: string;
  /** True once `text` is the target verbatim — the caller's cue to hand off to
   *  its real (rendered) representation. */
  settled: boolean;
}

export function useScrambledString(target: string, enabled: boolean): Scrambled {
  const [state, setState] = useState<Scrambled>({ text: target, settled: true });

  // Layout, not passive: a passive effect runs *after* paint, so the frame
  // between a new target arriving and the decode starting would flash the
  // finished problem — exactly what the animation exists to build up to.
  useLayoutEffect(() => {
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!enabled || !target || reduceMotion) {
      setState((prev) =>
        prev.settled && prev.text === target ? prev : { text: target, settled: true },
      );
      return;
    }

    const total = durationFor(target.length);
    const started = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / total);
      if (progress >= 1) {
        setState({ text: target, settled: true });
        return;
      }
      setState({ text: scramble(target, Math.floor(progress * target.length)), settled: false });
      frame = requestAnimationFrame(tick);
    };

    setState({ text: scramble(target, 0), settled: false });
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, enabled]);

  return state;
}
