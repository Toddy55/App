import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import { connectDatabaseEmulator, getDatabase, onValue, ref, set, type Database } from 'firebase/database';
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

async function init(): Promise<{ db: Database; uid: string }> {
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
