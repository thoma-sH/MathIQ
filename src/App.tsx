import { useEffect, useState, type ReactNode } from 'react';
import { Header } from './shell/Header';
import { InstallPrompt } from './shell/InstallPrompt';
import { Landing } from './screens/Landing';
import { Lessons } from './screens/Lessons';
import { WalkthroughCourse } from './screens/WalkthroughCourse';
import { TopicScreen } from './screens/Topic';
import { History } from './screens/History';
import { Settings } from './screens/Settings';
import { Terms } from './screens/Terms';
import { Privacy } from './screens/Privacy';
import { Exams } from './screens/Exams';
import { ExamTake } from './screens/ExamTake';
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
  if (route.name === 'exam-take') return `exam-take-${route.courseId}-${route.examId}`;
  return route.name;
}

function escapeTarget(route: Route): Route | null {
  if (route.name === 'topic') return { name: 'walkthrough', courseId: route.courseId };
  if (route.name === 'walkthrough') return { name: 'lessons' };
  if (route.name === 'lessons') return { name: 'home' };
  if (route.name === 'history') return { name: 'settings' };
  if (route.name === 'settings') return { name: 'home' };
  if (route.name === 'exams') return { name: 'walkthrough', courseId: route.courseId };
  if (route.name === 'exam-take') return { name: 'exams', courseId: route.courseId };
  return null;
}

// Legal pages are real URLs (Stripe Customer Portal links to them, so deep-
// linking has to work). Everything else uses internal `route` state.
function getLegalPath(): 'terms' | 'privacy' | null {
  if (typeof window === 'undefined') return null;
  const p = window.location.pathname.replace(/\/$/, '');
  if (p === '/terms') return 'terms';
  if (p === '/privacy') return 'privacy';
  return null;
}

export default function App() {
  const legalPath = getLegalPath();
  if (legalPath === 'terms') return <Terms />;
  if (legalPath === 'privacy') return <Privacy />;
  return <MathIQApp />;
}

function MathIQApp() {
  const [route, setRoute] = useState<Route>({ name: 'home' });

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [route]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = escapeTarget(route);
      if (target) setRoute(target);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [route]);

  return (
    <>
      <Header route={route} onNavigate={setRoute} />
      <Page routeKey={pageKey(route)}>
        {route.name === 'home'        && <Landing onNavigate={setRoute} />}
        {route.name === 'lessons'     && <Lessons onNavigate={setRoute} />}
        {route.name === 'walkthrough' && <WalkthroughCourse courseId={route.courseId} onNavigate={setRoute} />}
        {route.name === 'topic'       && <TopicScreen courseId={route.courseId} topicId={route.topicId} initialProblem={route.problem} onNavigate={setRoute} />}
        {route.name === 'history'     && <History onNavigate={setRoute} />}
        {route.name === 'settings'    && <Settings onNavigate={setRoute} />}
        {route.name === 'exams'       && <Exams courseId={route.courseId} onNavigate={setRoute} />}
        {route.name === 'exam-take'   && <ExamTake courseId={route.courseId} examId={route.examId} onNavigate={setRoute} />}
      </Page>
      <InstallPrompt />
    </>
  );
}
