import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import { connectDatabaseEmulator, getDatabase, onValue, ref, set, update, type Database } from 'firebase/database';
import { emulator, firebaseConfig } from './config';

/**
 * Live scoring sessions live at /live/{code}. Only the scorer's phone (the
 * anonymous user who created the session) can write; anyone with the code
 * can watch. The payload is the same compressed bundle used for share links.
 */
export interface LiveDoc {
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
  if (!firebaseConfig) throw new Error('Live scoring isn\'t set up yet (no Firebase config).');
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

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I mix-ups
export function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function normaliseCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export async function startLive(payload: Omit<LiveDoc, 'owner' | 'updatedAt'>, code = newCode()): Promise<string> {
  const { db, uid } = await init();
  await set(ref(db, `live/${code}`), { ...payload, owner: uid, updatedAt: Date.now() });
  return code;
}

/** Push the latest scores. Firebase queues this while offline and sends it when signal returns. */
export async function pushLive(code: string, payload: Omit<LiveDoc, 'owner' | 'updatedAt'>): Promise<void> {
  const { db, uid } = await init();
  await update(ref(db, `live/${code}`), { ...payload, owner: uid, updatedAt: Date.now() });
}

export async function watchLive(code: string, onDoc: (doc: LiveDoc | null) => void, onError: (e: Error) => void): Promise<() => void> {
  const { db } = await init();
  return onValue(
    ref(db, `live/${code}`),
    (snap) => onDoc(snap.exists() ? (snap.val() as LiveDoc) : null),
    (e) => onError(e),
  );
}
