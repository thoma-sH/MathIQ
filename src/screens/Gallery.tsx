/**
 * Gallery — the design canvas, repurposed as a real product screen.
 *
 * Originally a Figma-like artboard wrapper used during prototyping; here
 * it's a "browse every drill mode" view. Each mode renders as a scaled-down
 * preview tile that the user can tap to launch (or shift+tap to zoom in).
 * Lets people compare modes at a glance and pick the one that matches
 * their mood that session.
 */
import { useState, type ComponentType, type CSSProperties } from 'react';
import { T } from '../design/tokens';
import { Kicker } from '../design/Kicker';
import { DRILLS } from '../drills';
import type { DrillMode, DrillProps } from '../drills/types';
import type { Route } from '../router';

interface GalleryProps {
  onNavigate: (route: Route) => void;
}

const ARTBOARD_W = 1280;
const ARTBOARD_H = 800;

// noop callbacks — the preview tiles render the drills but don't actually
// participate in their lifecycle.
const noop: DrillProps['onExit'] = () => undefined;
const noopComplete: DrillProps['onComplete'] = () => undefined;

interface PreviewTileProps {
  mode: DrillMode;
  name: string;
  tag: string;
  kicker: string;
  description: string;
  Component: ComponentType<DrillProps>;
  zoomed: boolean;
  onLaunch: () => void;
  onZoom: () => void;
}

function PreviewTile({ mode, name, tag, kicker, description, Component, zoomed, onLaunch, onZoom }: PreviewTileProps) {
  const tileWidth = zoomed ? Math.min(window.innerWidth - 80, 1200) : 540;
  const scale = tileWidth / ARTBOARD_W;
  const tileHeight = ARTBOARD_H * scale;

  const tileStyle: CSSProperties = {
    width: tileWidth,
    height: tileHeight,
    overflow: 'hidden',
    position: 'relative',
    background: T.paper,
    boxShadow: zoomed
      ? '0 24px 80px rgba(0,0,0,0.25)'
      : '0 1px 3px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.06)',
    transition: 'box-shadow 200ms',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.accent, letterSpacing: '0.15em' }}>{tag}</span>
        <span style={{ fontFamily: T.serif, fontSize: 22, lineHeight: 1 }}>{name}</span>
        <span style={{ fontFamily: T.mono, fontSize: 10, opacity: 0.55, letterSpacing: '0.15em', textTransform: 'uppercase', marginLeft: 8 }}>
          {kicker}
        </span>
      </div>

      <div style={tileStyle}>
        {/* Render the actual drill at full size, scaled down. Pointer events
            are off so the preview is non-interactive — we use the tile as a
            single click target. */}
        <div
          style={{
            width: ARTBOARD_W,
            height: ARTBOARD_H,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            pointerEvents: 'none',
          }}
        >
          <Component domain="mixed" onExit={noop} onComplete={noopComplete} drillTimer={60} />
        </div>

        {/* Click-shield: capture clicks on the whole tile and route to launch. */}
        <button
          onClick={onLaunch}
          aria-label={`Launch ${name}`}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
          }}
        />

        {/* Zoom toggle in the corner. */}
        <button
          onClick={(e) => { e.stopPropagation(); onZoom(); }}
          aria-label={zoomed ? 'Collapse preview' : 'Expand preview'}
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            width: 28,
            height: 28,
            borderRadius: 4,
            border: `1px solid ${T.hair}`,
            background: 'rgba(244,239,230,0.85)',
            color: T.ink,
            cursor: 'pointer',
            fontFamily: T.mono,
            fontSize: 14,
            lineHeight: 1,
            backdropFilter: 'blur(8px)',
          }}
        >
          {zoomed ? '−' : '+'}
        </button>
      </div>

      <div style={{ fontSize: 13, opacity: 0.7, lineHeight: 1.5, maxWidth: tileWidth }}>{description}</div>
    </div>
  );
}

export function Gallery({ onNavigate }: GalleryProps) {
  const [zoomedId, setZoomedId] = useState<DrillMode | null>(null);

  return (
    <main className="responsive-pad" style={{ padding: '40px 36px', maxWidth: 1440, margin: '0 auto' }}>
      <Kicker className="reveal reveal-1" style={{ marginBottom: 8 }}>GALLERY · COMPARE EVERY DRILL MODE</Kicker>
      <h1 className="reveal reveal-2" style={{
        fontFamily: T.serif,
        fontSize: 'clamp(36px, 5vw, 64px)',
        lineHeight: 0.96,
        letterSpacing: '-0.03em',
        fontWeight: 400,
        margin: '0 0 12px',
      }}>
        See them side-by-side.
      </h1>
      <p className="reveal reveal-3" style={{ fontSize: 16, opacity: 0.7, maxWidth: 620, marginBottom: 32 }}>
        Live previews of all five drill modes. Click any tile to launch it. Hit{' '}
        <kbd style={{ fontFamily: T.mono, fontSize: 12, padding: '2px 6px', border: `1px solid ${T.hair}` }}>+</kbd>{' '}
        to zoom into one.
      </p>

      <div className="stagger-children" style={{
        display: zoomedId ? 'flex' : 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(540px, 100%), 1fr))',
        flexDirection: zoomedId ? 'column' : undefined,
        alignItems: zoomedId ? 'center' : undefined,
        gap: 32,
      }}>
        {DRILLS.map((d) => {
          if (zoomedId && zoomedId !== d.id) return null;
          return (
            <PreviewTile
              key={d.id}
              mode={d.id}
              name={d.name}
              tag={d.tag}
              kicker={d.kicker}
              description={d.description}
              Component={d.component}
              zoomed={zoomedId === d.id}
              onLaunch={() => onNavigate({ name: 'drill', mode: d.id, domain: 'mixed' })}
              onZoom={() => setZoomedId((z) => (z === d.id ? null : d.id))}
            />
          );
        })}
      </div>
    </main>
  );
}
