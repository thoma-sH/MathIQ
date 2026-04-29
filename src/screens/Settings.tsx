/**
 * Settings — the tweaks panel, made into a real screen.
 *
 * Originally a designer's floating panel for re-skinning the prototypes
 * live; here it's a proper Settings page that adjusts the user's
 * preferences. Same controls, but they save and they ship.
 */
import { T } from '../design/tokens';
import { Kicker } from '../design/Kicker';
import {
  COLOR_THEMES,
  FONT_STACKS,
  DENSITIES,
  AI_TONES,
  DIFFICULTY_VIEWS,
  useTweaks,
  type ColorTheme,
  type FontStack,
  type Density,
  type AiTone,
  type DifficultyView,
  type Tweaks,
} from '../state/tweaks';

interface RadioRowProps<V extends string> {
  label: string;
  value: V;
  options: readonly V[];
  onChange: (v: V) => void;
}

function RadioRow<V extends string>({ label, value, options, onChange }: RadioRowProps<V>) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 0', borderTop: `1px solid ${T.hair}` }}>
      <div style={{ width: 160, fontSize: 14 }}>{label}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            style={{
              padding: '6px 12px',
              border: `1px solid ${value === opt ? T.ink : T.hair}`,
              background: value === opt ? T.ink : 'transparent',
              color: value === opt ? T.paper : T.ink,
              fontSize: 12,
              fontFamily: T.mono,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}

function SliderRow({ label, value, min, max, step, unit, onChange }: SliderRowProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 0', borderTop: `1px solid ${T.hair}` }}>
      <div style={{ width: 160, fontSize: 14 }}>{label}</div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: T.ink }}
      />
      <div style={{ width: 60, textAlign: 'right', fontFamily: T.slab, fontSize: 16 }}>
        {value}
        {unit ?? ''}
      </div>
    </div>
  );
}

export function Settings() {
  const { tweaks, setTweak, reset } = useTweaks();

  // Tiny helper so we can pass the right type into setTweak in the same idiom.
  const set = <K extends keyof Tweaks>(key: K) => (v: Tweaks[K]) => setTweak(key, v);

  return (
    <main className="responsive-pad" style={{ padding: '40px 36px', maxWidth: 720, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 36, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <Kicker className="reveal reveal-1">SETTINGS · TWEAKS</Kicker>
          <h1 className="reveal reveal-2" style={{ fontFamily: T.serif, fontSize: 'clamp(36px, 5vw, 64px)', lineHeight: 0.96, letterSpacing: '-0.03em', fontWeight: 400, margin: '12px 0 0' }}>
            Make it yours.
          </h1>
        </div>
        <button onClick={reset} className="btn-press reveal reveal-3" style={{
          background: 'transparent',
          border: `1px solid ${T.ink}`,
          padding: '8px 14px',
          fontSize: 12,
          fontFamily: T.mono,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          cursor: 'pointer',
        }}>
          Reset
        </button>
      </div>

      <Kicker style={{ marginBottom: 8 }}>APPEARANCE</Kicker>
      <RadioRow<ColorTheme>      label="Color theme"       value={tweaks.colorTheme}     options={COLOR_THEMES}     onChange={set('colorTheme')} />
      <RadioRow<FontStack>       label="Typography"        value={tweaks.fontStack}      options={FONT_STACKS}      onChange={set('fontStack')} />
      <RadioRow<Density>         label="Density"           value={tweaks.density}        options={DENSITIES}        onChange={set('density')} />

      <div style={{ height: 36 }} />

      <Kicker style={{ marginBottom: 8 }}>DRILL DEFAULTS</Kicker>
      <SliderRow                 label="Drill timer"       value={tweaks.drillTimer}     min={5} max={120} step={5} unit="s" onChange={set('drillTimer')} />
      <RadioRow<DifficultyView>  label="Difficulty shown"  value={tweaks.difficultyView} options={DIFFICULTY_VIEWS} onChange={set('difficultyView')} />

      <div style={{ height: 36 }} />

      <Kicker style={{ marginBottom: 8 }}>AI TUTOR</Kicker>
      <RadioRow<AiTone>          label="Iris tone"         value={tweaks.aiTone}         options={AI_TONES}         onChange={set('aiTone')} />

      <div style={{ marginTop: 48, padding: 18, background: T.paper2, fontSize: 13, lineHeight: 1.5 }}>
        <Kicker style={{ marginBottom: 6 }}>SAVED LOCALLY</Kicker>
        Settings persist to <code style={{ fontFamily: T.mono, background: T.paper, padding: '1px 6px' }}>localStorage</code>.
        Color theme, font stack, and density apply via CSS variables on
        <code style={{ fontFamily: T.mono, background: T.paper, padding: '1px 6px', marginLeft: 4 }}>&lt;html&gt;</code> — every screen restyles instantly.
      </div>
    </main>
  );
}
