import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Header } from './shell/Header';
import { InstallPrompt } from './shell/InstallPrompt';
import { Landing } from './screens/Landing';
import { Subjects } from './screens/Subjects';
import { WalkthroughCourse } from './screens/WalkthroughCourse';
import { TopicScreen } from './screens/Topic';
import { History } from './screens/History';
import { Settings } from './screens/Settings';
import { Terms } from './screens/Terms';
import { Privacy } from './screens/Privacy';
import { Pricing } from './screens/Pricing';
import { Exams } from './screens/Exams';
import { ExamTake } from './screens/ExamTake';
import { ExamGrade } from './screens/ExamGrade';
import { Homework } from './screens/Homework';
import { UpgradeProvider } from './upgrade/UpgradePrompt';
import type { Route } from './router';

interface PageProps {
  routeKey: string;
  children: ReactNode;
}

function Page({ routeKey, children }: PageProps) {
  return <div key={routeKey} className="page-enter">{children}</div>;
}

function pageKey(route: Route): string {
  if (route.name === 'walkthrough') return `walkthrough-${route.courseId}`;
  if (route.name === 'topic') return `topic-${route.courseId}-${route.topicId}`;
  if (route.name === 'exams') return `exams-${route.courseId}`;
  if (route.name === 'exam-take') return `exam-take-${route.recordId}`;
  if (route.name === 'exam-grade') return `exam-grade-${route.recordId}`;
  return route.name;
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
function getRealUrlPath(): 'terms' | 'privacy' | 'pricing' | null {
  if (typeof window === 'undefined') return null;
  const p = window.location.pathname.replace(/\/$/, '');
  if (p === '/terms') return 'terms';
  if (p === '/privacy') return 'privacy';
  if (p === '/pricing') return 'pricing';
  return null;
}

export default function App() {
  const realPath = getRealUrlPath();
  if (realPath === 'terms') return <Terms />;
  if (realPath === 'privacy') return <Privacy />;
  if (realPath === 'pricing') return <Pricing />;
  return <MathIQApp />;
}

function MathIQApp() {
  const [route, setRoute] = useState<Route>({ name: 'home' });

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

  // Anchor the very first history entry to the home route so the user's
  // first back press from anywhere lands cleanly here (or exits the app
  // in PWA mode) instead of leaving an unexpected state behind.
  useEffect(() => {
    try {
      const s = window.history.state as { name?: unknown } | null;
      if (!s || typeof s.name !== 'string') {
        window.history.replaceState({ name: 'home' }, '');
      }
    } catch {
      // ignore
    }
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
      const target = escapeTarget(route);
      if (target) navigate(target);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [route, navigate]);

  return (
    <UpgradeProvider>
      <Header route={route} onNavigate={navigate} />
      <Page routeKey={pageKey(route)}>
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
      </Page>
      <InstallPrompt />
    </UpgradeProvider>
  );
}
