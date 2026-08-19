import { useLayoutEffect, useState } from 'react';

/**
 * Decodes `target` left to right, one discrete frame at a time.
 *
 * Ported from the scramble on thomashamilton.bio (hover the name). Two details
 * there carry the whole effect, and both are easy to lose in a rewrite:
 *
 *  - The tick is a 35ms interval, not an animation frame. Re-rolling at 60Hz
 *    outruns the eye and reads as static noise; at ~29Hz you see individual
 *    characters flip, which is the thing that looks like decoding.
 *  - The lock front is proportional (`i / len < frame / FRAMES`), so the sweep
 *    takes the same ~630ms whether it decodes nine characters or ninety.
 *
 * Whitespace passes through unscrambled — the original preserves `.` for the
 * same reason. Here it also keeps word shape and line count steady, so a
 * monospace render can't reflow mid-decode.
 *
 * Deliberately does NOT check `prefers-reduced-motion`. The reference does not
 * either, and gating on it made the decode settle instantly for anyone with
 * the OS setting on — indistinguishable from the animation being broken, since
 * no duration change has any visible effect. A short text decode is mild
 * compared to the parallax and scroll-jacking that setting exists to suppress.
 * `enabled: false` is the only way to skip it.
 */
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz░▒▓';

/** The flip cadence, held at the reference's value. This is the number that
 *  makes it read as decoding rather than as noise, so the duration below is
 *  bought with more frames rather than slower ones. */
const FRAME_MS = 35;

/** How long the decode takes, start to finish. Flat, not scaled by length:
 *  the reference sweeps a nine-character name in 630ms, which is over before
 *  it registers on a problem statement ten times longer. */
const DURATION_MS = 3000;
const FRAMES = Math.round(DURATION_MS / FRAME_MS);

function scramble(target: string, progress: number): string {
  const len = target.length;
  let out = '';
  for (let i = 0; i < len; i++) {
    const ch = target[i];
    out +=
      i / len < progress || ch === ' ' || ch === '\n'
        ? ch
        : GLYPHS[(Math.random() * GLYPHS.length) | 0];
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
    if (!enabled || !target) {
      setState((prev) =>
        prev.settled && prev.text === target ? prev : { text: target, settled: true },
      );
      return;
    }

    let frame = 0;
    const id = window.setInterval(() => {
      frame += 1;
      if (frame > FRAMES) {
        window.clearInterval(id);
        setState({ text: target, settled: true });
        return;
      }
      setState({ text: scramble(target, frame / FRAMES), settled: false });
    }, FRAME_MS);

    setState({ text: scramble(target, 0), settled: false });
    return () => window.clearInterval(id);
  }, [target, enabled]);

  return state;
}
