import type { Course, Round, Settings } from '../types';

const K = { courses: 'gtg.courses', rounds: 'gtg.rounds', settings: 'gtg.settings', friends: 'gtg.friends' };

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

export const DEFAULT_CLUBS = ['Driver', '3W', '5W', 'Hybrid', '4i', '5i', '6i', '7i', '8i', '9i', 'PW', 'GW', 'SW', 'LW', 'Putter'];

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const store = {
  courses: (): Course[] => read(K.courses, []),
  saveCourse(c: Course) {
    const all = store.courses().filter((x) => x.id !== c.id);
    write(K.courses, [{ ...c, updatedAt: Date.now() }, ...all]);
  },
  deleteCourse(id: string) {
    write(K.courses, store.courses().filter((x) => x.id !== id));
  },
  rounds: (): Round[] => read(K.rounds, []),
  round: (id: string) => store.rounds().find((r) => r.id === id),
  saveRound(r: Round) {
    const all = store.rounds().filter((x) => x.id !== r.id);
    write(K.rounds, [r, ...all]);
  },
  deleteRound(id: string) {
    write(K.rounds, store.rounds().filter((x) => x.id !== id));
  },
  settings: (): Settings =>
    read<Settings>(K.settings, {
      me: { id: 'me', name: 'Me', gaHandicap: 18 },
      units: 'm',
      clubs: DEFAULT_CLUBS,
    }),
  saveSettings(s: Settings) {
    write(K.settings, s);
  },
  friends: (): { id: string; name: string; gaHandicap: number }[] => read(K.friends, []),
  saveFriends(f: { id: string; name: string; gaHandicap: number }[]) {
    write(K.friends, f);
  },
};
