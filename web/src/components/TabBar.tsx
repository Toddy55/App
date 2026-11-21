import { ChartColumn, Flag, House, Trophy, Video } from 'lucide-react';
import type { Go, Route } from './ui';
import { store } from '../lib/storage';

/** App-style bottom navigation for the main screens. */
export function TabBar({ route, go }: { route: Route; go: Go }) {
  const live = store.rounds().find((r) => !r.completed);
  const is = (...names: Route['name'][]) => names.includes(route.name);
  return (
    <nav className="tabbar" aria-label="Main">
      <button className={is('home') ? 'on' : ''} onClick={() => go({ name: 'home' })}>
        <House />
        <span>Home</span>
      </button>
      <button className={is('leaderboards', 'comp', 'friends', 'friend') ? 'on' : ''} onClick={() => go({ name: 'leaderboards' })}>
        <Trophy />
        <span>Comps</span>
      </button>
      <button className="tab-play" onClick={() => go(live ? { name: 'play', roundId: live.id } : { name: 'setup' })}>
        <span className="play-dot">
          <Flag />
        </span>
        <span>{live ? 'Resume' : 'Play'}</span>
      </button>
      <button className={is('tracer') ? 'on' : ''} onClick={() => go({ name: 'tracer' })}>
        <Video />
        <span>Tracer</span>
      </button>
      <button className={is('stats') ? 'on' : ''} onClick={() => go({ name: 'stats' })}>
        <ChartColumn />
        <span>Stats</span>
      </button>
    </nav>
  );
}

/** Screens that show the bottom bar (not mid-round or while filming). */
export const TAB_SCREENS: Route['name'][] = ['home', 'courses', 'course', 'leaderboards', 'comp', 'friends', 'friend', 'stats', 'settings', 'tracer', 'summary'];
