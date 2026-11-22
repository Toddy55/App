import { useEffect, useState } from 'react';
import type { Bundle } from '../lib/share';
import { personKey } from '../lib/share';
import { store } from '../lib/storage';
import type { LiveNote } from './crewChannel';

/** Friends playing live right now, shared between the app-wide watcher and the screens. */
let current: LiveNote[] = [];
const subs = new Set<(l: LiveNote[]) => void>();

export function setLiveFriends(l: LiveNote[]) {
  current = l;
  subs.forEach((f) => f(l));
}

export function useLiveFriends(): LiveNote[] {
  const [l, setL] = useState(current);
  useEffect(() => {
    subs.add(setL);
    setL(current);
    return () => {
      subs.delete(setL);
    };
  }, []);
  return l;
}

/** Pick up mates' crew codes from anything shared with this phone (comp invites, rounds, live cards). */
export function learnCrews(b: Bundle) {
  const friends = store.friends();
  let changed = false;
  for (const p of b.people) {
    if (!p.crew) continue;
    const f = friends.find((x) => personKey(x.name) === p.key);
    if (f && f.crew !== p.crew) {
      store.saveFriend({ ...f, crew: p.crew });
      changed = true;
    }
  }
  if (changed) window.dispatchEvent(new Event('gtg:friends'));
}
