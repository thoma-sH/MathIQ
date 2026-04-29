# MathIQ

Mental math trainer — speed drills + AI tutor across arithmetic → calculus.

Built on the editorial design system from [`legacy/MathIQ.html`](legacy/MathIQ.html)
(originally a Claude Design prototype): cream paper, ink, single tangerine
accent, slab serif numerals.

## Quickstart

```bash
npm install
npm run dev        # Vite dev server on :5173
npm run build      # type-check + production bundle in dist/
npm run typecheck  # type-check only
```

## Project structure

```
src/
├─ main.tsx                # entry — mounts <App>
├─ App.tsx                 # shell + route switch
├─ router.ts               # Route discriminated union
├─ index.css               # CSS variables + global resets
│
├─ design/                 # design system primitives
│  ├─ tokens.ts            # T.* — references CSS vars
│  ├─ Kicker.tsx           # mono uppercase label
│  └─ buttons.ts           # primary/ghost/chip helpers
│
├─ math/                   # problem generators
│  ├─ types.ts             # Domain, Problem
│  ├─ generators.ts        # genProblem(domain) — arithmetic … calculus
│  └─ checkAnswer.ts       # tolerant equality (numeric + string answers)
│
├─ state/                  # global app state
│  ├─ tweaks.tsx           # TweaksProvider + useTweaks (themes, density, timer)
│  └─ stats.ts             # useStats — streak / today's solved
│
├─ shell/                  # surface chrome
│  ├─ TopNav.tsx
│  └─ DrillBack.tsx        # floating back button on full-bleed drills
│
├─ drills/                 # the five drill modes (one bold idea each)
│  ├─ types.ts             # DrillMode, DrillProps, DrillResult
│  ├─ index.tsx            # DRILLS registry — add a drill in one place
│  ├─ PulseDrill.tsx       # 01 newspaper front-page, BPM beat tracker
│  ├─ StreamDrill.tsx      # 02 ledger feed, combo scoring
│  ├─ VoiceDrill.tsx       # 03 hands-free, breathing waveform
│  ├─ LayersDrill.tsx      # 04 visual decomposition stepper
│  └─ ArenaDrill.tsx       # 05 head-to-head with AI
│
├─ screens/                # everything that isn't a drill
│  ├─ Onboard.tsx          # first-run placement
│  ├─ Dashboard.tsx        # "today" — recommended + continue
│  ├─ DrillPicker.tsx      # mode + domain picker
│  ├─ Gallery.tsx          # browse all 5 modes side-by-side (live)
│  ├─ Tutor.tsx            # Iris chat
│  ├─ Library.tsx          # 8-track lesson grid
│  ├─ Profile.tsx          # streak grid, badges, records
│  ├─ Settings.tsx         # tweaks panel as a real settings page
│  └─ Results.tsx          # post-drill debrief
│
└─ tour/
   └─ Tour.tsx             # first-run walkthrough overlay
```

## Architecture notes

**Theming via CSS variables.** Color theme, typography, and density are
set as `data-*` attributes on `<html>` by `TweaksContext`. All tokens in
[`src/design/tokens.ts`](src/design/tokens.ts) reference CSS vars (e.g.
`var(--accent)`), so a theme change re-skins every screen with no
re-render. To add a theme: add a `[data-theme='foo'] { --accent: … }`
block in `src/index.css`, then add `'foo'` to `COLOR_THEMES` in
[`src/state/tweaks.tsx`](src/state/tweaks.tsx).

**Drill registry.** [`src/drills/index.tsx`](src/drills/index.tsx) is the
single place where drills are declared. The `DrillPicker`, `Gallery`,
and `App` route handler all consume it — adding a 6th drill is one new
component file plus one entry in `DRILLS`.

**Routes are a discriminated union.** [`src/router.ts`](src/router.ts)
defines `Route` so the route switch in `App.tsx` is exhaustive — a new
route requires a `Route` variant + a render branch. No string-typed nav
calls.

**Persistence.** Settings and stats persist to `localStorage` under
namespaced keys (`mathiq:tweaks`, `mathiq:stats`, `mathiq:onboard`,
`mathiq:tour-seen`). Storage failures (private mode / quota) degrade
silently — the in-memory state still works.

## Adding things

| Thing                  | Touch                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| New drill mode         | `src/drills/<Foo>Drill.tsx` + entry in `src/drills/index.tsx`                                        |
| New top-level screen   | `src/screens/<Foo>.tsx` + `Route` variant + branch in `App.tsx` + (optional) tab in `TopNav.tsx`     |
| New problem domain     | `Domain` in `src/math/types.ts` + generator in `src/math/generators.ts` + chip in `DrillPicker.tsx`  |
| New theme / font stack | CSS vars in `src/index.css` + entry in `COLOR_THEMES` / `FONT_STACKS` in `src/state/tweaks.tsx`      |

## Legacy

[`legacy/MathIQ.html`](legacy/MathIQ.html) is the prototype
that this modular codebase was created from.
