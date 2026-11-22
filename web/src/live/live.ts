import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import { connectDatabaseEmulator, endAt, get, getDatabase, limitToLast, onValue, orderByKey, query, ref, set, startAt, type Database } from 'firebase/database';
import { emulator, firebaseConfig } from './config';

/**
 * A live event lives at /events/{code}. Each group on the course has its own
 * scorer, who writes only their own card at /events/{code}/groups/{groupId}.
 * Anyone with the code can watch every group. The payload is the same
 * compressed bundle used for share links.
 */
export interface GroupDoc {
  owner: string;
  data: string;
  status: 'live' | 'final';
  hole: number;
  headline: string;
  scorer: string;
  updatedAt: number;
}

let app: FirebaseApp | null = null;
let db: Database | null = null;

let ready: Promise<{ db: Database; uid: string }> | null = null;

/**
 * Connect and sign in once. Several parts of the app start up together (the
 * mate watcher, a link-up, live scoring); without sharing one sign-in they'd
 * each create a different anonymous user and the writes would be refused.
 */
function init(): Promise<{ db: Database; uid: string }> {
  if (!ready) {
    ready = connect().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

async function connect(): Promise<{ db: Database; uid: string }> {
  if (!firebaseConfig) throw new Error("Live scoring isn't set up yet (no Firebase config).");
  if (!app) {
    app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    if (emulator.auth) connectAuthEmulator(auth, `http://${emulator.auth}`, { disableWarnings: true });
    db = getDatabase(app);
    if (emulator.database) {
      const [host, port] = emulator.database.split(':');
      connectDatabaseEmulator(db, host, Number(port));
    }
  }
  const auth = getAuth(app);
  const user = auth.currentUser ?? (await signInAnonymously(auth)).user;
  return { db: db!, uid: user.uid };
}

/** Push this group's latest card. Firebase queues it while offline and sends it when signal returns. */
export async function pushGroup(code: string, groupId: string, payload: Omit<GroupDoc, 'owner' | 'updatedAt'>): Promise<void> {
  const { db, uid } = await init();
  await set(ref(db, `events/${code}/groups/${groupId}`), { ...payload, owner: uid, updatedAt: Date.now() });
}

export async function watchEvent(
  code: string,
  onGroups: (groups: Record<string, GroupDoc> | null) => void,
  onError: (e: Error) => void,
): Promise<() => void> {
  const { db } = await init();
  return onValue(
    ref(db, `events/${code}/groups`),
    (snap) => onGroups(snap.exists() ? (snap.val() as Record<string, GroupDoc>) : null),
    (e) => onError(e),
  );
}

/** Like watchEvent, but only the newest `n` entries (keys sort by time). Used for chat. */
export async function watchLatest(
  code: string,
  n: number,
  onGroups: (groups: Record<string, GroupDoc> | null) => void,
  onError: (e: Error) => void,
): Promise<() => void> {
  const { db } = await init();
  return onValue(
    query(ref(db, `events/${code}/groups`), orderByKey(), limitToLast(n)),
    (snap) => onGroups(snap.exists() ? (snap.val() as Record<string, GroupDoc>) : null),
    (e) => onError(e),
  );
}

/** This phone's anonymous sign-in id (to tell your own chat messages apart). */
export async function myUid(): Promise<string> {
  return (await init()).uid;
}

/** Watch only the entries whose key starts with `prefix` (e.g. clip index entries, not their data). */
export async function watchPrefix(
  code: string,
  prefix: string,
  onGroups: (groups: Record<string, GroupDoc> | null) => void,
  onError: (e: Error) => void,
): Promise<() => void> {
  const { db } = await init();
  return onValue(
    query(ref(db, `events/${code}/groups`), orderByKey(), startAt(prefix), endAt(prefix + '\uf8ff')),
    (snap) => onGroups(snap.exists() ? (snap.val() as Record<string, GroupDoc>) : null),
    (e) => onError(e),
  );
}

/** Read one entry once. */
export async function getEntry(code: string, id: string): Promise<GroupDoc | null> {
  const { db } = await init();
  const snap = await get(ref(db, `events/${code}/groups/${id}`));
  return snap.exists() ? (snap.val() as GroupDoc) : null;
}

/** "Hey Siri, mark shot" spots for this phone's mark key (newest 300). */
export async function watchMarks(key: string, onMarks: (marks: Record<string, { lat: number; lon: number; club?: string }> | null) => void): Promise<() => void> {
  const { db } = await init();
  return onValue(
    query(ref(db, `marks/${key}`), limitToLast(300)),
    (snap) => onMarks(snap.exists() ? (snap.val() as Record<string, { lat: number; lon: number; club?: string }>) : null),
    () => undefined,
  );
}

// ---- Sync (your data across copies of the app) ----

/** Write one value at a path under sync/. */
export async function syncSet(path: string, value: unknown): Promise<void> {
  const { db } = await init();
  await set(ref(db, `sync/${path}`), value);
}

/** Read everything under a path once. */
export async function syncGet<T>(path: string): Promise<T | null> {
  const { db } = await init();
  const snap = await get(ref(db, `sync/${path}`));
  return snap.exists() ? (snap.val() as T) : null;
}

/** Keep watching a path under sync/. */
export async function syncWatch<T>(path: string, on: (v: T | null) => void): Promise<() => void> {
  const { db } = await init();
  return onValue(ref(db, `sync/${path}`), (snap) => on(snap.exists() ? (snap.val() as T) : null), () => undefined);
}
