/**
 * 04 LAYERS — visual decomposition. Walks through the same problem in
 * stages so the user sees the trick they should be doing in their head.
 */
import { useState } from 'react';
import { T } from '../design/tokens';
import { Kicker } from '../design/Kicker';
import { DrillBack } from '../shell/DrillBack';
import { primaryBtn, ghostBtn } from '../design/buttons';
import type { DrillProps } from './types';

const ACCENT_COBALT = '#1d4ed8';
const LAYERS_BG = '#fafaf3';

interface Step {
  l: string;
  expand: string;
}

const STEPS: Step[] = [
  { l: '47 × 8',     expand: 'Break 47 into 40 + 7' },
  { l: '40 × 8',     expand: '40 × 8 = 320' },
  { l: '7 × 8',      expand: '7 × 8 = 56' },
  { l: '320 + 56',   expand: 'Sum: 376' },
];

const Underline = ({ children }: { children: React.ReactNode }) => (
  <span style={{ borderBottom: '2px solid currentColor', paddingBottom: 2 }}>{children}</span>
);

export function LayersDrill({ onExit, onComplete }: DrillProps) {
  const [step, setStep] = useState(0);
  const next = () => {
    if (step < STEPS.length - 1) setStep(step + 1);
    else onComplete({ mode: 'Layers', solved: 1 });
  };

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      minHeight: 'calc(100vh - 60px)',
      background: LAYERS_BG,
      color: '#0a0a0a',
      fontFamily: T.sans,
      display: 'grid',
      gridTemplateRows: 'auto 1fr auto',
      backgroundImage: `linear-gradient(${ACCENT_COBALT}08 1px, transparent 1px), linear-gradient(90deg, ${ACCENT_COBALT}08 1px, transparent 1px)`,
      backgroundSize: '32px 32px',
    }}>
      <DrillBack onClick={onExit} />

      <header style={{ padding: '20px 40px 20px 100px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${ACCENT_COBALT}20` }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>MathIQ</span>
          <span style={{ fontSize: 12, opacity: 0.5 }}>/ Layers / Multiplication / Two-digit × One</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              width: 28, height: 4, borderRadius: 2,
              background: i <= step ? ACCENT_COBALT : `${ACCENT_COBALT}25`,
              transition: 'background 200ms',
            }} />
          ))}
        </div>
      </header>

      <main className="grid-layers" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, position: 'relative' }}>
          <Kicker style={{ marginBottom: 12 }}>Step {step + 1} of {STEPS.length}</Kicker>

          <div className="fade-in" key={step} style={{ fontSize: 'clamp(64px, 8vw, 96px)', lineHeight: 1, letterSpacing: '-0.04em', fontWeight: 500, marginBottom: 8, fontFamily: T.slab }}>
            {step === 0 && (<><Underline>47</Underline> × 8</>)}
            {step === 1 && (<><span style={{ color: ACCENT_COBALT }}>40</span> × 8 = <span style={{ color: ACCENT_COBALT }}>320</span></>)}
            {step === 2 && (<><span style={{ color: ACCENT_COBALT }}>7</span> × 8 = <span style={{ color: ACCENT_COBALT }}>56</span></>)}
            {step === 3 && (<>320 + 56 = <span style={{ color: ACCENT_COBALT }}>376</span></>)}
          </div>

          <div style={{ fontSize: 18, opacity: 0.7, marginBottom: 36 }}>{STEPS[step]!.expand}</div>

          <div style={{ width: 440, height: 200, position: 'relative', border: `1.5px solid ${ACCENT_COBALT}`, background: '#fff', display: 'flex', flexDirection: 'column', maxWidth: '100%' }}>
            <div style={{ display: 'flex', height: 36, borderBottom: `1px solid ${ACCENT_COBALT}40` }}>
              <div style={{ flex: 40, display: 'grid', placeItems: 'center', fontSize: 14, fontFamily: T.mono, background: step >= 1 ? `${ACCENT_COBALT}15` : 'transparent', transition: 'background 300ms' }}>40</div>
              <div style={{ flex: 7, display: 'grid', placeItems: 'center', borderLeft: `1px dashed ${ACCENT_COBALT}60`, fontSize: 14, fontFamily: T.mono, background: step >= 2 ? `${ACCENT_COBALT}15` : 'transparent', transition: 'background 300ms' }}>7</div>
            </div>
            <div style={{ flex: 1, display: 'flex', position: 'relative' }}>
              <div style={{ flex: 40, position: 'relative', background: step >= 1 ? `${ACCENT_COBALT}10` : 'transparent', transition: 'background 300ms' }}>
                {step >= 1 && (
                  <div className="fade-in" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 36, fontWeight: 600, color: ACCENT_COBALT }}>320</div>
                )}
              </div>
              <div style={{ flex: 7, position: 'relative', borderLeft: `1px dashed ${ACCENT_COBALT}60`, background: step >= 2 ? `${ACCENT_COBALT}10` : 'transparent', transition: 'background 300ms' }}>
                {step >= 2 && (
                  <div className="fade-in" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 22, fontWeight: 600, color: ACCENT_COBALT }}>56</div>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 32, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button onClick={() => setStep((s) => Math.max(0, s - 1))} style={ghostBtn(ACCENT_COBALT)}>← Back</button>
            <button onClick={next} style={primaryBtn(ACCENT_COBALT, '#fff')}>{step === STEPS.length - 1 ? 'Got it ↵' : 'Next step →'}</button>
            <button onClick={() => setStep(STEPS.length - 1)} style={{ ...ghostBtn(ACCENT_COBALT), marginLeft: 12 }}>I knew this</button>
          </div>
        </div>

        <aside style={{ borderLeft: `1px solid ${ACCENT_COBALT}20`, padding: '32px', background: '#ffffff80' }}>
          <Kicker style={{ marginBottom: 20 }}>Decomposition</Kicker>
          {STEPS.map((s, i) => (
            <div key={i} onClick={() => setStep(i)} style={{
              padding: '14px 16px', marginBottom: 6, cursor: 'pointer',
              border: `1px solid ${i === step ? ACCENT_COBALT : 'transparent'}`,
              background: i === step ? `${ACCENT_COBALT}08` : (i < step ? '#0000000a' : 'transparent'),
              transition: 'all 150ms',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: 11, fontFamily: T.mono, opacity: 0.5 }}>L{i + 1}</span>
                {i < step && <span style={{ fontSize: 11, color: ACCENT_COBALT }}>✓</span>}
              </div>
              <div style={{ fontSize: 22, fontWeight: 500, marginTop: 4, opacity: i <= step ? 1 : 0.4, fontFamily: T.slab }}>{s.l}</div>
              <div style={{ fontSize: 12, opacity: 0.55, marginTop: 2 }}>{s.expand}</div>
            </div>
          ))}
          <div style={{ marginTop: 24, padding: 14, background: `${ACCENT_COBALT}08`, borderLeft: `2px solid ${ACCENT_COBALT}`, fontSize: 13, lineHeight: 1.5 }}>
            <b style={{ fontFamily: T.mono, fontSize: 11, letterSpacing: '0.1em' }}>MENTAL TIP</b>
            <div style={{ marginTop: 6, opacity: 0.8 }}>When multiplying by 8, double three times: 47 → 94 → 188 → 376.</div>
          </div>
        </aside>
      </main>

      <footer style={{ padding: '14px 40px', borderTop: `1px solid ${ACCENT_COBALT}20`, display: 'flex', justifyContent: 'space-between', fontSize: 11, opacity: 0.55, fontFamily: T.mono, gap: 12, flexWrap: 'wrap' }}>
        <span>↵ next · ⌘K change problem</span>
        <span>Walkthrough · sample lesson</span>
      </footer>
    </div>
  );
}
