import { T } from '../design/tokens';

interface DrillBackProps {
  onClick: () => void;
}

/**
 * Floating back button shown over a full-bleed drill (no top nav).
 * Always positioned in the same spot so muscle-memory works across the
 * five drill modes.
 */
export function DrillBack({ onClick }: DrillBackProps) {
  return (
    <button
      onClick={onClick}
      className="drill-back"
      style={{
        position: 'absolute',
        top: 14,
        left: 16,
        zIndex: 30,
        background: 'rgba(244,239,230,0.85)',
        border: `1px solid ${T.hair}`,
        padding: '6px 12px',
        fontFamily: T.mono,
        fontSize: 11,
        letterSpacing: '0.15em',
        cursor: 'pointer',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      ← BACK
    </button>
  );
}
