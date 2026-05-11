import { useEffect, useState, type ReactNode } from 'react';
import { Header } from './shell/Header';
import { Landing } from './screens/Landing';
import { Lessons } from './screens/Lessons';
import { WalkthroughCourse } from './screens/WalkthroughCourse';
import { TopicScreen } from './screens/Topic';
import { Settings } from './screens/Settings';
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
  return route.name;
}

function escapeTarget(route: Route): Route | null {
  if (route.name === 'topic') return { name: 'walkthrough', courseId: route.courseId };
  if (route.name === 'walkthrough') return { name: 'lessons' };
  if (route.name === 'lessons') return { name: 'home' };
  if (route.name === 'settings') return { name: 'home' };
  return null;
}

export default function App() {
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
        {route.name === 'settings'    && <Settings />}
      </Page>
    </>
  );
}
