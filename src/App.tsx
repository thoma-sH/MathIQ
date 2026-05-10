import { useEffect, useState, type ReactNode } from 'react';
import { Header } from './shell/Header';
import { Home } from './screens/Home';
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

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'home' });

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [route]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (route.name === 'topic') setRoute({ name: 'walkthrough', courseId: route.courseId });
      else if (route.name === 'walkthrough') setRoute({ name: 'home' });
      else if (route.name === 'settings') setRoute({ name: 'home' });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [route]);

  return (
    <>
      <Header route={route} onNavigate={setRoute} />
      <Page routeKey={pageKey(route)}>
        {route.name === 'home'        && <Home onNavigate={setRoute} />}
        {route.name === 'walkthrough' && <WalkthroughCourse courseId={route.courseId} onNavigate={setRoute} />}
        {route.name === 'topic'       && <TopicScreen courseId={route.courseId} topicId={route.topicId} initialProblem={route.problem} onNavigate={setRoute} />}
        {route.name === 'settings'    && <Settings />}
      </Page>
    </>
  );
}
