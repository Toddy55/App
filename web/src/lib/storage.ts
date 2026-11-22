import type { Competition, Course, Player, Round, Settings } from '../types';

const K = { courses: 'gtg.courses', rounds: 'gtg.rounds', settings: 'gtg.settings', friends: 'gtg.friends', comps: 'gtg.comps' };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('Could not save', key, e);
  }
}

/**
 * Sync bookkeeping: when each record last changed on this phone, so copies of
 * the app (Safari, the Home Screen app, another phone) can take the newest.
 * Kinds: r = round, f = friend, c = comp, k = course, s = settings.
 */
export type SyncKind = 'r' | 'f' | 'c' | 'k' | 's';
const STAMPS = 'gtg.stamps';
export function stamps(): Record<string, number> {
  return read<Record<string, number>>(STAMPS, {});
}
let quiet = 0;
/** Apply changes that came from sync without echoing them back out. */
export function quietly<T>(fn: () => T): T {
  quiet++;
  try {
    return fn();
  } finally {
    quiet--;
  }
}
export function stamp(kind: SyncKind, id: string, at = Date.now(), deleted = false) {
  const all = stamps();
  all[`${kind}:${id}`] = deleted ? -at : at;
  write(STAMPS, all);
  if (!quiet && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('gtg:changed', { detail: { kind, id } }));
}

export const DEFAULT_CLUBS = ['Driver', '3W', '5W', 'Hybrid', '4i', '5i', '6i', '7i', '8i', '9i', 'PW', 'GW', 'SW', 'LW', 'Putter'];

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const store = {
  courses: (): Course[] => read(K.courses, []),
  saveCourse(c: Course) {
    const all = store.courses().filter((x) => x.id !== c.id);
    write(K.courses, [{ ...c, updatedAt: Date.now() }, ...all]);
    stamp('k', c.id);
  },
  deleteCourse(id: string) {
    write(K.courses, store.courses().filter((x) => x.id !== id));
    stamp('k', id, Date.now(), true);
  },
  rounds: (): Round[] => read(K.rounds, []),
  round: (id: string) => store.rounds().find((r) => r.id === id),
  saveRound(r: Round) {
    const all = store.rounds().filter((x) => x.id !== r.id);
    write(K.rounds, [r, ...all]);
    stamp('r', r.id);
  },
  deleteRound(id: string) {
    write(K.rounds, store.rounds().filter((x) => x.id !== id));
    stamp('r', id, Date.now(), true);
  },
  settings: (): Settings =>
    read<Settings>(K.settings, {
      me: { id: 'me', name: 'Me', gaHandicap: 18 },
      units: 'm',
      clubs: DEFAULT_CLUBS,
    }),
  saveSettings(s: Settings) {
    write(K.settings, s);
    stamp('s', 'me');
  },
  friends: (): Player[] => read(K.friends, []),
  saveFriends(f: Player[]) {
    const before = new Map(store.friends().map((x) => [x.id, JSON.stringify(x)]));
    write(K.friends, f);
    for (const x of f) if (before.get(x.id) !== JSON.stringify(x)) stamp('f', x.id);
    for (const id of before.keys()) if (!f.some((x) => x.id === id)) stamp('f', id, Date.now(), true);
  },
  saveFriend(p: Player) {
    const all = store.friends();
    const i = all.findIndex((x) => x.id === p.id);
    if (i >= 0) all[i] = p;
    else all.push(p);
    store.saveFriends(all);
  },
  deleteFriend(id: string) {
    store.saveFriends(store.friends().filter((f) => f.id !== id));
  },
  comps: (): Competition[] => read(K.comps, []),
  comp: (id: string) => store.comps().find((c) => c.id === id),
  saveComp(c: Competition) {
    write(K.comps, [c, ...store.comps().filter((x) => x.id !== c.id)]);
    stamp('c', c.id);
  },
  deleteComp(id: string) {
    write(K.comps, store.comps().filter((x) => x.id !== id));
    stamp('c', id, Date.now(), true);
  },
  /** Display name for a player id on this phone. */
  nameOf(id: string, fallback?: string) {
    if (id === 'me') return store.settings().me.name;
    return store.friends().find((f) => f.id === id)?.name ?? fallback ?? 'Unknown';
  },
};

/**
 * Tidy-up: a friend called "Me" is really you (the placeholder name of a copy
 * that wasn't set up yet when it linked). Point their rounds and comps back at
 * you and remove them.
 */
export function fixMeFriend() {
  const ghosts = store.friends().filter((f) => f.name.trim().toLowerCase() === 'me');
  for (const g of ghosts) {
    for (const r of store.rounds()) {
      if (!r.players.some((p) => p.id === g.id)) continue;
      // Already in the round as yourself: just drop the duplicate
      const hasMe = r.players.some((p) => p.id === 'me');
      const swap = (id: string) => (id === g.id ? 'me' : id);
      const scores: Round['scores'] = {};
      for (const [k, v] of Object.entries(r.scores)) if (!(hasMe && k === g.id)) scores[swap(k)] = v;
      store.saveRound({
        ...r,
        players: hasMe ? r.players.filter((p) => p.id !== g.id) : r.players.map((p) => (p.id === g.id ? { ...p, id: 'me', name: store.settings().me.name } : p)),
        teams: r.teams?.map((t) => ({ ...t, playerIds: [...new Set(t.playerIds.map(swap))] })),
        scores,
        meId: swap(r.meId),
      });
    }
    for (const c of store.comps()) if (c.memberIds.includes(g.id)) store.saveComp({ ...c, memberIds: [...new Set(c.memberIds.map((id) => (id === g.id ? 'me' : id)))] });
    store.deleteFriend(g.id);
  }
}
