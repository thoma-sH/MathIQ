/**
 * CSS-only confetti burst. Fires once on mount and self-cleans after the
 * animation finishes. Used to celebrate a correct Daily Challenge grade.
 *
 * Respects `prefers-reduced-motion: reduce` — renders nothing for users
 * who've opted out of animations. No npm dep; ~50 lines.
 */
import { useEffect, useMemo, useState } from 'react';

const PIECE_COUNT = 32;
const DURATION_MS = 1800;

const COLORS = [
  '#d4e26a', // paper (pistachio)
  '#1a4d6e', // accent (deep teal)
  '#2f7a9b', // accent-2 (lighter teal)
  '#3d6e5f', // accent-3 (sage)
  '#f6d769', // sunlit yellow for variety
];

interface Piece {
  id: number;
  left: number; // 0–100 (vw %)
  delay: number; // ms
  duration: number; // ms
  drift: number; // px horizontal sway
  spin: number; // deg total rotation
  color: string;
  size: number; // px
  shape: 'square' | 'rect';
}

export function Confetti() {
  const [active, setActive] = useState(true);

  const reducedMotion = useMemo(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const pieces = useMemo<Piece[]>(() => {
    if (reducedMotion) return [];
    return Array.from({ length: PIECE_COUNT }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 250,
      duration: DURATION_MS + Math.random() * 600,
      drift: (Math.random() - 0.5) * 220,
      spin: (Math.random() - 0.5) * 720,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      size: 6 + Math.random() * 8,
      shape: Math.random() < 0.5 ? 'square' : 'rect',
    }));
  }, [reducedMotion]);

  useEffect(() => {
    if (reducedMotion) return;
    const t = window.setTimeout(() => setActive(false), DURATION_MS + 800);
    return () => window.clearTimeout(t);
  }, [reducedMotion]);

  if (reducedMotion || !active) return null;

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 10000,
      }}
    >
      {pieces.map((p) => (
        <span
          key={p.id}
          style={{
            position: 'absolute',
            top: -20,
            left: `${p.left}vw`,
            width: p.shape === 'rect' ? p.size * 1.6 : p.size,
            height: p.shape === 'rect' ? p.size * 0.6 : p.size,
            background: p.color,
            opacity: 0,
            animation: `confetti-fall ${p.duration}ms cubic-bezier(0.2, 0.7, 0.4, 1) ${p.delay}ms forwards`,
            // Per-piece CSS vars feed the keyframe transforms.
            // @ts-expect-error custom CSS vars
            '--drift': `${p.drift}px`,
            '--spin': `${p.spin}deg`,
          }}
        />
      ))}
      <style>{`
        @keyframes confetti-fall {
          0% {
            opacity: 0;
            transform: translate(0, 0) rotate(0deg);
          }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% {
            opacity: 0;
            transform: translate(var(--drift), 105vh) rotate(var(--spin));
          }
        }
      `}</style>
    </div>
  );
}
