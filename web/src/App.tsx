import { useEffect, useState } from 'react';
import type { Route } from './components/ui';
import { Home } from './screens/Home';
import { Courses } from './screens/Courses';
import { CourseEditor } from './screens/CourseEditor';
import { Setup } from './screens/Setup';
import { Play } from './screens/Play';
import { Summary } from './screens/Summary';
import { Stats } from './screens/Stats';
import { Settings } from './screens/Settings';

function readHash(): Route {
  try {
    const raw = decodeURIComponent(location.hash.slice(1));
    if (raw) return JSON.parse(raw) as Route;
  } catch {
    /* ignore */
  }
  return { name: 'home' };
}

export default function App() {
  const [route, setRoute] = useState<Route>(readHash);
  useEffect(() => {
    const on = () => setRoute(readHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (r: Route) => {
    location.hash = encodeURIComponent(JSON.stringify(r));
    window.scrollTo(0, 0);
  };
  const key = JSON.stringify(route);
  switch (route.name) {
    case 'home':
      return <Home key={key} go={go} />;
    case 'courses':
      return <Courses key={key} go={go} pick={route.pick} />;
    case 'course':
      return <CourseEditor key={key} go={go} id={route.id} />;
    case 'setup':
      return <Setup key={key} go={go} courseId={route.courseId} />;
    case 'play':
      return <Play key={key} go={go} roundId={route.roundId} />;
    case 'summary':
      return <Summary key={key} go={go} roundId={route.roundId} />;
    case 'stats':
      return <Stats key={key} go={go} />;
    case 'settings':
      return <Settings key={key} go={go} />;
  }
}
