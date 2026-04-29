/**
 * App — top-level shell + route switch.
 *
 * Drills render full-bleed (their own headers); every other route gets
 * the TopNav. Onboarding takes over the whole screen on first run. The
 * Tour is global and self-dismisses after first use.
 *
 * Each route render is keyed on `route.name` and wrapped with
 * `.page-enter` so transitioning between routes triggers a soft
 * fade/slide rather than a hard cut.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { TopNav } from './shell/TopNav';
import { Onboard } from './screens/Onboard';
import { Dashboard } from './screens/Dashboard';
import { DrillPicker } from './screens/DrillPicker';
import { Gallery } from './screens/Gallery';
import { Tutor } from './screens/Tutor';
import { Library } from './screens/Library';
import { Profile } from './screens/Profile';
import { Settings } from './screens/Settings';
import { Results } from './screens/Results';
import { Tour } from './tour/Tour';
import { TweaksProvider, useTweaks } from './state/tweaks';
import { useStats } from './state/stats';
import { DRILLS_BY_ID } from './drills';
import { VoiceDrill } from './drills/VoiceDrill';
import type { Route } from './router';
import type { DrillResult } from './drills/types';

interface PageProps {
  routeKey: string;
  children: ReactNode;
}

/**
 * Wraps a route in a keyed div so React unmounts/remounts on route
 * change and the page-enter animation fires fresh each time.
 */
function Page({ routeKey, children }: PageProps) {
  return <div key={routeKey} className="page-enter">{children}</div>;
}

function Shell() {
  const { tweaks } = useTweaks();
  const { stats, recordDrillResult } = useStats();
  // Always boot into onboarding — every run is a first-time experience.
  const [route, setRoute] = useState<Route>({ name: 'onboard' });
  const [lastResult, setLastResult] = useState<DrillResult | null>(null);

  // Esc on a drill or results screen pops back one level.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (route.name === 'drill') setRoute({ name: 'drills' });
      else if (route.name === 'results') setRoute({ name: 'home' });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [route]);

  // Scroll to top on every route change so navigating doesn't strand
  // the user mid-page.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [route.name]);

  const finishOnboard = useCallback((target: Route) => {
    setRoute(target);
  }, []);

  const completeDrill = useCallback(
    (result: DrillResult) => {
      recordDrillResult(result);
      setLastResult(result);
      setRoute({ name: 'results' });
    },
    [recordDrillResult],
  );

  if (route.name === 'onboard') {
    return <Onboard onStart={finishOnboard} />;
  }

  // Drills run full-bleed, no top nav.
  if (route.name === 'drill') {
    const exit = () => setRoute({ name: 'drills' });
    const props = {
      domain: route.domain,
      onExit: exit,
      onComplete: completeDrill,
      drillTimer: tweaks.drillTimer,
    };
    // VoiceDrill takes an extra aiTone prop; the other four ignore it.
    if (route.mode === 'voice') {
      return (
        <Page routeKey={`drill-voice-${route.domain}`}>
          <VoiceDrill {...props} aiTone={tweaks.aiTone} />
        </Page>
      );
    }
    const Drill = DRILLS_BY_ID[route.mode].component;
    return (
      <Page routeKey={`drill-${route.mode}-${route.domain}`}>
        <Drill {...props} />
      </Page>
    );
  }

  return (
    <>
      <TopNav route={route} onNavigate={setRoute} streak={stats.streak} />
      <Page routeKey={route.name}>
        {route.name === 'home'     && <Dashboard onNavigate={setRoute} stats={stats} />}
        {route.name === 'drills'   && <DrillPicker onNavigate={setRoute} />}
        {route.name === 'gallery'  && <Gallery onNavigate={setRoute} />}
        {route.name === 'tutor'    && <Tutor />}
        {route.name === 'library'  && <Library onNavigate={setRoute} />}
        {route.name === 'profile'  && <Profile stats={stats} />}
        {route.name === 'settings' && <Settings />}
        {route.name === 'results'  && <Results result={lastResult} onNavigate={setRoute} />}
      </Page>
      <Tour />
    </>
  );
}

export default function App() {
  return (
    <TweaksProvider>
      <Shell />
    </TweaksProvider>
  );
}
