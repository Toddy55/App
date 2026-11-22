import { useEffect, useRef } from 'react';
import type { Hole, Round } from '../types';
import { applySiriMarks, pushIdTime, type SiriMark } from '../lib/siriMarks';
import { firebaseConfig, liveAvailable } from './config';
import { store } from '../lib/storage';

/** This phone's private key for Siri marks (only your Shortcut knows it). */
export function myMarkKey(): string {
  try {
    let k = localStorage.getItem('gtg.markKey');
    if (!k) {
      const a = new Uint8Array(12);
      crypto.getRandomValues(a);
      k = [...a].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
      localStorage.setItem('gtg.markKey', k);
    }
    return k;
  } catch {
    return '';
  }
}

/** The web address your Shortcut posts your spot to. */
export function markUrl(): string | null {
  const db = firebaseConfig?.databaseURL;
  const k = myMarkKey();
  if (!db || !k) return null;
  try {
    const u = new URL(db);
    u.pathname = `${u.pathname.replace(/\/$/, '')}/marks/${k}.json`;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * While a round is open: pick up Siri marks and drop them into the round as
 * shots on the right holes.
 */
export function useSiriMarks(round: Round | undefined, holes: Hole[], update: (fn: (r: Round) => Round) => void, onAdded: (added: { hole: number; club?: string }[]) => void) {
  const live = !!round && !round.completed && liveAvailable() && (() => {
    try {
      return !!localStorage.getItem('gtg.markKey');
    } catch {
      return false;
    }
  })();
  const latest = useRef({ holes, update, onAdded, store });
  latest.current = { holes, update, onAdded, store };
  const id = round?.id;
  useEffect(() => {
    if (!live || !id) return;
    let unsub: (() => void) | undefined;
    let stop = false;
    import('./live')
      .then(({ watchMarks }) =>
        watchMarks(myMarkKey(), (raw) => {
          if (stop || !raw) return;
          const marks: SiriMark[] = Object.entries(raw).flatMap(([mid, v]) => {
            const t = pushIdTime(mid);
            return t && typeof v?.lat === 'number' && typeof v?.lon === 'number' ? [{ id: mid, lat: v.lat, lon: v.lon, t, ...(typeof v.club === 'string' ? { club: v.club } : {}) }] : [];
          });
          const { store } = latest.current;
          const now = store.round(id);
          if (!now) return;
          const clubs = store.settings().clubs;
          const { added } = applySiriMarks(now, marks, latest.current.holes, clubs);
          if (!added.length) return;
          latest.current.update((r) => applySiriMarks(r, marks, latest.current.holes, clubs).round);
          latest.current.onAdded(added);
        }),
      )
      .then((u) => (stop ? u() : (unsub = u)))
      .catch(() => undefined);
    return () => {
      stop = true;
      unsub?.();
    };
  }, [live, id]);
}
