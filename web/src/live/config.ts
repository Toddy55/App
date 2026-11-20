/**
 * Live scoring uses a Firebase Realtime Database.
 *
 * Paste your Firebase web config below (Firebase console → Project settings →
 * Your apps → Web app → "firebaseConfig"), or set VITE_FIREBASE_CONFIG to the
 * same object as JSON at build time. This config is not a secret: access is
 * controlled by the database rules in /database.rules.json.
 */
export interface FirebaseWebConfig {
  apiKey: string;
  authDomain?: string;
  databaseURL: string;
  projectId: string;
  appId?: string;
  [k: string]: string | undefined;
}

const PASTED_CONFIG: FirebaseWebConfig | null = null;

function fromEnv(): FirebaseWebConfig | null {
  const raw = import.meta.env.VITE_FIREBASE_CONFIG as string | undefined;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FirebaseWebConfig;
  } catch {
    console.warn('VITE_FIREBASE_CONFIG is not valid JSON');
    return null;
  }
}

export const firebaseConfig: FirebaseWebConfig | null = fromEnv() ?? PASTED_CONFIG;

/** Set to "host:port" pairs for local testing against the Firebase emulators. */
export const emulator = {
  database: import.meta.env.VITE_FIREBASE_DB_EMULATOR as string | undefined,
  auth: import.meta.env.VITE_FIREBASE_AUTH_EMULATOR as string | undefined,
};

export const liveAvailable = () => !!firebaseConfig?.databaseURL;
