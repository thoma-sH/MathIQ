import { useEffect, useState } from 'react';

/**
 * Types the target string one character at a time. Honors prefers-reduced-motion
 * by jumping to the full string immediately.
 */
export function useTypedString(
  target: string,
  perCharMs: number,
  startDelayMs: number,
): string {
  const [text, setText] = useState('');
  useEffect(() => {
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setText(target);
      return;
    }
    setText('');
    let cancelled = false;
    let charTimer = 0;
    const start = window.setTimeout(() => {
      let i = 0;
      const tick = () => {
        if (cancelled) return;
        i += 1;
        setText(target.slice(0, i));
        if (i < target.length) charTimer = window.setTimeout(tick, perCharMs);
      };
      charTimer = window.setTimeout(tick, perCharMs);
    }, startDelayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(start);
      window.clearTimeout(charTimer);
    };
  }, [target, perCharMs, startDelayMs]);
  return text;
}
