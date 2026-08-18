import { Suspense, lazy, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { Header } from './shell/Header';
import { InstallPrompt } from './shell/InstallPrompt';
import { Landing } from './screens/Landing';
import { UpgradeProvider } from './upgrade/UpgradePrompt';
import { T } from './design/tokens';
import { COURSES_BY_ID } from './walkthroughs/courses';
import { readSession } from './state/walkthroughSession';
import type { Route } from './router';

// All non-home screens are split off into their own chunks so the initial
// bundle only carries Landing + the shell. Each route fetches its chunk on
// first navigation; subsequent visits within the session are cached.
const Subjects = lazy(() => import('./screens/Subjects').then((m) => ({ default: m.Subjects })));
const WalkthroughCourse = lazy(() => import('./screens/WalkthroughCourse').then((m) => ({ default: m.WalkthroughCourse })));
const TopicScreen = lazy(() => import('./screens/Topic').then((m) => ({ default: m.TopicScreen })));
const History = lazy(() => import('./screens/History').then((m) => ({ default: m.History })));
const Settings = lazy(() => import('./screens/Settings').then((m) => ({ default: m.Settings })));
const Terms = lazy(() => import('./screens/Terms').then((m) => ({ default: m.Terms })));
const Privacy = lazy(() => import('./screens/Privacy').then((m) => ({ default: m.Privacy })));
const Pricing = lazy(() => import('./screens/Pricing').then((m) => ({ default: m.Pricing })));
const Share = lazy(() => import('./screens/Share').then((m) => ({ default: m.Share })));
const Exams = lazy(() => import('./screens/Exams').then((m) => ({ default: m.Exams })));
const ExamTake = lazy(() => import('./screens/ExamTake').then((m) => ({ default: m.ExamTake })));
const ExamGrade = lazy(() => import('./screens/ExamGrade').then((m) => ({ default: m.ExamGrade })));
const Homework = lazy(() => import('./screens/Homework').then((m) => ({ default: m.Homework })));
const DailyChallenge = lazy(() => import('./screens/DailyChallenge').then((m) => ({ default: m.DailyChallenge })));

interface PageProps {
  routeKey: string;
  children: ReactNode;
}

function Page({ routeKey, children }: PageProps) {
  return (
    <div key={routeKey} id="main-content" tabIndex={-1} className="page-enter" style={{ outline: 'none' }}>
      {children}
    </div>
  );
}

// Fade-in is delayed 200ms so chunks that load fast never flash the skeleton;
// only slow loads see the placeholder appear and ease in.
function RouteSkeleton() {
  return (
    <div
      aria-busy="true"
      style={{
        maxWidth: 760,
        margin: '40px auto',
        padding: '24px 22px',
        border: `1px solid ${T.hair}`,
        background: T.paper2,
        opacity: 0,
        animation: 'page-enter 360ms ease-out 200ms forwards',
      }}
    >
      <div style={{ height: 28, width: '50%', background: T.hair }} />
      <div style={{ height: 16, width: '85%', background: T.hair, marginTop: 14 }} />
      <div style={{ height: 16, width: '70%', background: T.hair, marginTop: 8 }} />
    </div>
  );
}

function pageKey(route: Route): string {
  if (route.name === 'walkthrough') return `walkthrough-${route.courseId}`;
  if (route.name === 'topic') return `topic-${route.courseId}-${route.topicId}`;
  if (route.name === 'exams') return `exams-${route.courseId}`;
  if (route.name === 'exam-take') return `exam-take-${route.recordId}`;
  if (route.name === 'exam-grade') return `exam-grade-${route.recordId}`;
  return route.name;
}

// Human-readable label per route — drives document.title and the polite
// screen-reader announcement on navigation (SPA route changes are otherwise
// silent for assistive tech).
function routeLabel(route: Route): string {
  switch (route.name) {
    case 'home': return 'Home';
    case 'subjects': return 'Subjects';
    case 'walkthrough': return COURSES_BY_ID[route.courseId]?.title ?? 'Course';
    case 'topic': {
      const course = COURSES_BY_ID[route.courseId];
      const topic = course?.topics.find((t) => t.id === route.topicId);
      return topic?.title ?? course?.title ?? 'Topic';
    }
    case 'history': return 'History';
    case 'settings': return 'Settings';
    case 'exams': return `Exams · ${COURSES_BY_ID[route.courseId]?.title ?? 'Course'}`;
    case 'exam-take': return 'Take exam';
    case 'exam-grade': return 'Grade exam';
    case 'homework': return 'Handwritten to PDF';
  }
}

function escapeTarget(route: Route): Route | null {
  if (route.name === 'topic') return { name: 'walkthrough', courseId: route.courseId };
  if (route.name === 'walkthrough') return { name: 'subjects' };
  if (route.name === 'subjects') return { name: 'home' };
  if (route.name === 'history') return { name: 'settings' };
  if (route.name === 'settings') return { name: 'home' };
  if (route.name === 'exams') return { name: 'walkthrough', courseId: route.courseId };
  if (route.name === 'exam-take') return { name: 'exams', courseId: route.courseId };
  if (route.name === 'exam-grade') return { name: 'exam-take', courseId: route.courseId, recordId: route.recordId };
  if (route.name === 'homework') return { name: 'home' };
  return null;
}

// Legal / marketing pages are real URLs (Stripe Customer Portal + outside
// links use them) so deep-linking has to work. Everything else uses
// internal `route` state.
type RealUrl =
  | { kind: 'terms' }
  | { kind: 'privacy' }
  | { kind: 'pricing' }
  | { kind: 'daily' }
  | { kind: 'share'; shareId: string };

function getRealUrlPath(): RealUrl | null {
  if (typeof window === 'undefined') return null;
  const p = window.location.pathname.replace(/\/$/, '');
  if (p === '/terms') return { kind: 'terms' };
  if (p === '/privacy') return { kind: 'privacy' };
  if (p === '/pricing') return { kind: 'pricing' };
  if (p === '/daily') return { kind: 'daily' };
  // /share/<shareId> — opaque hex id. Defensive validation matches the
  // worker's 16-char hex format so a typo'd URL goes to NotFound, not the
  // share screen with broken state.
  if (p.startsWith('/share/')) {
    const id = p.slice('/share/'.length);
    if (/^[a-f0-9]{4,64}$/i.test(id)) return { kind: 'share', shareId: id };
  }
  return null;
}

const REAL_URL_TITLES: Record<RealUrl['kind'], string> = {
  terms: 'Terms · MathIQ',
  privacy: 'Privacy · MathIQ',
  pricing: 'Pricing · MathIQ',
  daily: 'Daily Challenge · MathIQ',
  share: 'Shared challenge · MathIQ',
};

export default function App() {
  const realPath = getRealUrlPath();
  useEffect(() => {
    if (realPath) document.title = REAL_URL_TITLES[realPath.kind];
    // realPath is derived from location.pathname, which never changes without
    // a full navigation — mount-only is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (realPath) {
    return (
      <>
        <Suspense fallback={<RouteSkeleton />}>
          {realPath.kind === 'terms' && <Terms />}
          {realPath.kind === 'privacy' && <Privacy />}
          {realPath.kind === 'pricing' && <Pricing />}
          {realPath.kind === 'daily' && <DailyChallenge />}
          {realPath.kind === 'share' && <Share shareId={realPath.shareId} />}
        </Suspense>
        <Analytics />
      </>
    );
  }
  return <MathIQApp />;
}

// How recently a walkthrough must have been touched for us to reopen it
// automatically. Snapshots survive far longer than this (see
// walkthroughSession), but taking over the landing page is only reasonable
// when the student plausibly just got bounced — a sign-in redirect, an
// accidental refresh. Past this window the snapshot still restores, just not
// until they navigate back to the topic themselves.
const AUTO_RESUME_WINDOW_MS = 30 * 60 * 1000;

function initialRoute(): Route {
  const saved = readSession();
  if (!saved) return { name: 'home' };
  if (Date.now() - saved.updatedAt > AUTO_RESUME_WINDOW_MS) return { name: 'home' };
  const course = COURSES_BY_ID[saved.courseId];
  if (!course?.topics.some((t) => t.id === saved.topicId)) return { name: 'home' };
  // `problem` is deliberately omitted: setting it makes TopicScreen treat this
  // as a fresh request and generate a new walkthrough. The problem text comes
  // back through the snapshot instead.
  return { name: 'topic', courseId: saved.courseId, topicId: saved.topicId };
}

function MathIQApp() {
  const [route, setRoute] = useState<Route>(initialRoute);

  // Wraps setRoute so every internal navigation pushes a history entry.
  // That gives us a working browser back/forward button on web *and* the
  // iOS PWA edge-swipe (and the in-app back arrow in Header).
  const navigate = useCallback((target: Route) => {
    try {
      window.history.pushState(target, '');
    } catch {
      // Sandboxed contexts can throw — fall back to state-only navigation.
    }
    setRoute(target);
  }, []);

  // Anchor the very first history entry to the route we opened on, so the
  // user's first back press lands cleanly (or exits the app in PWA mode)
  // instead of leaving an unexpected state behind.
  useEffect(() => {
    try {
      const s = window.history.state as { name?: unknown } | null;
      if (!s || typeof s.name !== 'string') {
        // Anchor to whatever we actually rendered. On a resume that's the
        // topic, so the first back press escapes to the course page as usual
        // rather than to a home screen the student never saw.
        window.history.replaceState(route, '');
      }
    } catch {
      // ignore
    }
    // Mount-only: this seeds the very first history entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync state with the history stack whenever the user pops (browser
  // back/forward, iOS edge-swipe, or our in-app back button).
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const s = e.state as { name?: unknown } | null;
      if (s && typeof s.name === 'string') {
        setRoute(s as Route);
      } else {
        setRoute({ name: 'home' });
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [route]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Escape belongs to whatever the user is interacting with first:
      // a focused text field (first press blurs it, typed work intact —
      // the next press navigates) or an open modal dialog (ours or
      // Clerk's — they close on the same keypress).
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        t.blur();
        return;
      }
      if (document.querySelector('[aria-modal="true"]')) return;
      const target = escapeTarget(route);
      if (target) navigate(target);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [route, navigate]);

  // Title + polite announcement per route. The announcement is skipped on
  // first mount — page load is already announced by the browser.
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    const label = routeLabel(route);
    document.title =
      route.name === 'home' ? 'MathIQ — math problems, walked through' : `${label} · MathIQ`;
    if (route.name !== 'home' || announcement !== '') setAnnouncement(label);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  return (
    <UpgradeProvider>
      <a href="#main-content" className="skip-link chamfer">
        Skip to content
      </a>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <Header route={route} onNavigate={navigate} />
      <Page routeKey={pageKey(route)}>
        <Suspense fallback={<RouteSkeleton />}>
          {route.name === 'home'        && <Landing onNavigate={navigate} />}
          {route.name === 'subjects'    && <Subjects onNavigate={navigate} />}
          {route.name === 'walkthrough' && <WalkthroughCourse courseId={route.courseId} onNavigate={navigate} />}
          {route.name === 'topic'       && <TopicScreen courseId={route.courseId} topicId={route.topicId} initialProblem={route.problem} onNavigate={navigate} />}
          {route.name === 'history'     && <History onNavigate={navigate} />}
          {route.name === 'settings'    && <Settings onNavigate={navigate} />}
          {route.name === 'exams'       && <Exams courseId={route.courseId} onNavigate={navigate} />}
          {route.name === 'exam-take'   && <ExamTake courseId={route.courseId} recordId={route.recordId} onNavigate={navigate} />}
          {route.name === 'exam-grade'  && <ExamGrade courseId={route.courseId} recordId={route.recordId} onNavigate={navigate} />}
          {route.name === 'homework'    && <Homework onNavigate={navigate} />}
        </Suspense>
      </Page>
      <InstallPrompt />
      <Analytics />
    </UpgradeProvider>
  );
}
