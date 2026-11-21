import { useEffect, useState, type ReactNode } from 'react';
import { TabBar, TAB_SCREENS } from './components/TabBar';
import type { Route } from './components/ui';
import { Home } from './screens/Home';
import { Courses } from './screens/Courses';
import { CourseEditor } from './screens/CourseEditor';
import { Setup } from './screens/Setup';
import { Play } from './screens/Play';
import { Summary } from './screens/Summary';
import { Stats } from './screens/Stats';
import { Settings } from './screens/Settings';
import { FriendDetail, Friends } from './screens/Friends';
import { CompDetail, CompEditor, Leaderboards } from './screens/Leaderboards';
import { Import } from './screens/Import';
import { JoinComp } from './screens/JoinComp';
import { Chat } from './screens/Chat';
import { FriendJoin } from './screens/FriendJoin';
import { MateWatcher } from './components/MateWatcher';
import { LiveView } from './live/LiveView';
import { Tracer } from './screens/Tracer';
import { LiveTracer } from './screens/LiveTracer';

function readHash(): Route {
  try {
    if (location.hash.startsWith('#import=')) return { name: 'import', data: location.hash.slice(8) };
    if (location.hash.startsWith('#live=')) return { name: 'live', code: location.hash.slice(6).toUpperCase() };
    if (location.hash.startsWith('#join=')) {
      const [data, to] = location.hash.slice(6).split('&to=');
      return { name: 'joinComp', data, to: to ? decodeURIComponent(to) : undefined };
    }
    if (location.hash.startsWith('#friend=')) {
      const [data, to] = location.hash.slice(8).split('&to=');
      return { name: 'friendJoin', data, to: to ? decodeURIComponent(to) : undefined };
    }
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
  const withNav = TAB_SCREENS.includes(route.name);
  useEffect(() => {
    document.body.classList.toggle('has-nav', withNav);
  }, [withNav]);
  const screen = renderScreen(route, key, go);
  return (
    <>
      {screen}
      {withNav && <TabBar route={route} go={go} />}
      <MateWatcher go={go} />
    </>
  );
}

function renderScreen(route: Route, key: string, go: (r: Route) => void): ReactNode {
  switch (route.name) {
    case 'home':
      return <Home key={key} go={go} />;
    case 'courses':
      return <Courses key={key} go={go} pick={route.pick} />;
    case 'course':
      return <CourseEditor key={key} go={go} id={route.id} />;
    case 'setup':
      return <Setup key={key} go={go} courseId={route.courseId} join={route.liveCode ? { code: route.liveCode, format: route.format, holes: route.holes, compIds: route.compIds } : undefined} />;
    case 'play':
      return <Play key={key} go={go} roundId={route.roundId} />;
    case 'summary':
      return <Summary key={key} go={go} roundId={route.roundId} />;
    case 'stats':
      return <Stats key={key} go={go} />;
    case 'settings':
      return <Settings key={key} go={go} />;
    case 'friends':
      return <Friends key={key} go={go} />;
    case 'friend':
      return <FriendDetail key={key} go={go} id={route.id} />;
    case 'friendJoin':
      return <FriendJoin key={key} go={go} data={route.data} to={route.to} />;
    case 'chat':
      return <Chat key={key} go={go} compId={route.compId} />;
    case 'joinComp':
      return <JoinComp key={key} go={go} data={route.data} to={route.to} />;
    case 'leaderboards':
      return <Leaderboards key={key} go={go} />;
    case 'comp':
      return <CompDetail key={key} go={go} id={route.id} />;
    case 'compEdit':
      return <CompEditor key={key} go={go} id={route.id} />;
    case 'import':
      return <Import key={key} go={go} data={route.data} />;
    case 'live':
      return <LiveView key={key} go={go} code={route.code} />;
    case 'tracer':
      return <Tracer key={key} go={go} />;
    case 'livetracer':
      return <LiveTracer key={key} go={go} />;
  }
}
