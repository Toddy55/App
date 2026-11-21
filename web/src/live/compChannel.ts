import type { Competition, Player } from '../types';
import { personKey } from '../lib/share';
import { store, uid } from '../lib/storage';
import { liveAvailable } from './config';

/**
 * Who's in a comp, kept in step across everyone's phones. When a mate opens
 * an invite link and joins, their name goes up under the comp's own channel
 * (it rides on the same Firebase space as live scoring), and every phone that
 * has the comp open adds them to its member list.
 */
export interface Joiner {
  name: string;
  ga: number;
  at: number;
}

const channel = (comp: Competition) => `comp-${comp.id}`;

function slot(comp: Competition): string {
  const k = `gtg.compSlot.${comp.id}`;
  try {
    const have = localStorage.getItem(k);
    if (have) return have;
    const s = 'j' + uid().slice(0, 8);
    localStorage.setItem(k, s);
    return s;
  } catch {
    return 'j' + uid().slice(0, 8);
  }
}

/** Tell everyone in the comp that this phone's golfer is in. */
export async function announceJoin(comp: Competition, me: Player): Promise<void> {
  if (!liveAvailable()) throw new Error('Live sync is not set up');
  const { pushGroup } = await import('./live');
  const j: Joiner = { name: me.name, ga: me.gaHandicap, at: Date.now() };
  await pushGroup(channel(comp), slot(comp), { data: JSON.stringify(j), status: 'live', hole: 0, headline: 'joined', scorer: me.name });
}

/** Watch for mates joining. Calls back with everyone who has joined through a link. */
export async function watchJoiners(comp: Competition, onJoiners: (j: Joiner[]) => void): Promise<() => void> {
  if (!liveAvailable()) return () => undefined;
  const { watchEvent } = await import('./live');
  return watchEvent(
    channel(comp),
    (docs) => {
      const list: Joiner[] = [];
      for (const d of Object.values(docs ?? {})) {
        try {
          const j = JSON.parse(d.data) as Joiner;
          if (j && typeof j.name === 'string' && j.name.trim()) list.push({ name: j.name.trim().slice(0, 40), ga: Number(j.ga) || 0, at: Number(j.at) || 0 });
        } catch {
          /* not one of ours */
        }
      }
      onJoiners(list);
    },
    () => undefined,
  );
}

/**
 * Add any joiners this phone doesn't have as members yet (as friends if
 * they're new to this phone). Returns the names that were added.
 */
export function addJoiners(comp: Competition, joiners: Joiner[]): { comp: Competition; added: string[] } {
  const settings = store.settings();
  const friends = store.friends();
  const members = new Set(comp.memberIds);
  const added: string[] = [];
  for (const j of joiners) {
    const key = personKey(j.name);
    let id = personKey(settings.me.name) === key ? 'me' : friends.find((f) => personKey(f.name) === key)?.id;
    if (!id) {
      const f: Player = { id: uid(), name: j.name, gaHandicap: j.ga };
      friends.push(f);
      store.saveFriend(f);
      id = f.id;
    }
    if (!members.has(id)) {
      members.add(id);
      added.push(j.name);
    }
  }
  if (!added.length) return { comp, added };
  const next = { ...comp, memberIds: [...members] };
  store.saveComp(next);
  return { comp: next, added };
}
