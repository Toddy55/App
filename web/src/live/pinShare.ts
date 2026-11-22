import { useEffect, useRef } from 'react';
import type { LatLon, Round } from '../types';
import { liveAvailable } from './config';

/**
 * The pin is the same for everyone in the field: when anyone in a live round
 * (any group in the event) marks it, every phone gets it.
 */
interface PinDoc {
  by: string;
  pins: Record<string, LatLon & { t: number }>;
}

const channel = (code: string) => `pins-${code}`;

export function usePinShare(round: Round | undefined, me: string, update: (fn: (r: Round) => Round) => void, onNew: (by: string, hole: number) => void) {
  const code = round?.liveCode;
  const latest = useRef({ update, onNew, me });
  latest.current = { update, onNew, me };

  // Send ours when we mark one
  const mine = round ? JSON.stringify(Object.entries(round.pinsAt ?? {}).filter(([h]) => round.pinsBy?.[Number(h)] === undefined)) : '';
  useEffect(() => {
    if (!round || !code || !liveAvailable()) return;
    const pins: PinDoc['pins'] = {};
    for (const [h, t] of Object.entries(round.pinsAt ?? {})) {
      const p = round.pins[Number(h)];
      if (p && round.pinsBy?.[Number(h)] === undefined) pins[h] = { lat: p.lat, lon: p.lon, t };
    }
    if (!Object.keys(pins).length) return;
    const doc: PinDoc = { by: me, pins };
    import('./live')
      .then(async ({ pushGroup, myUid }) => pushGroup(channel(code), 'p' + (await myUid()).slice(0, 10), { data: JSON.stringify(doc), status: 'live', hole: 0, headline: 'pins', scorer: me }))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, mine]);

  // Take anyone's newer pin
  useEffect(() => {
    if (!code || !liveAvailable()) return;
    let unsub: (() => void) | undefined;
    let stop = false;
    import('./live')
      .then(async ({ watchEvent, myUid }) => {
        const slot = 'p' + (await myUid()).slice(0, 10);
        return watchEvent(
          channel(code),
          (docs) => {
            if (stop || !docs) return;
            const best = new Map<number, { p: LatLon; t: number; by: string }>();
            for (const [id, d] of Object.entries(docs)) {
              if (id === slot) continue;
              try {
                const doc = JSON.parse(d.data) as PinDoc;
                for (const [h, p] of Object.entries(doc.pins ?? {})) {
                  const n = Number(h);
                  if (typeof p?.lat !== 'number' || typeof p?.lon !== 'number' || typeof p.t !== 'number') continue;
                  if (!best.has(n) || best.get(n)!.t < p.t) best.set(n, { p: { lat: p.lat, lon: p.lon }, t: p.t, by: String(doc.by ?? 'A mate').slice(0, 40) });
                }
              } catch {
                /* skip */
              }
            }
            const fresh: { hole: number; by: string }[] = [];
            latest.current.update((r) => {
              let next = r;
              for (const [n, b] of best) {
                if ((r.pinsAt?.[n] ?? 0) >= b.t) continue;
                next = { ...next, pins: { ...next.pins, [n]: b.p }, pinsAt: { ...(next.pinsAt ?? {}), [n]: b.t }, pinsBy: { ...(next.pinsBy ?? {}), [n]: b.by } };
                fresh.push({ hole: n, by: b.by });
              }
              return next;
            });
            setTimeout(() => fresh.forEach((f) => latest.current.onNew(f.by, f.hole)), 0);
          },
          () => undefined,
        );
      })
      .then((u) => (stop ? u() : (unsub = u)))
      .catch(() => undefined);
    return () => {
      stop = true;
      unsub?.();
    };
  }, [code]);
}

/** Set the pin on a hole yourself (stamped so everyone's phones take the newest). */
export function withPin(r: Round, hole: number, p: LatLon | undefined): Round {
  const pins = { ...r.pins };
  const pinsAt = { ...(r.pinsAt ?? {}) };
  const pinsBy = { ...(r.pinsBy ?? {}) };
  delete pinsBy[hole];
  if (p) {
    pins[hole] = p;
    pinsAt[hole] = Date.now();
  } else {
    delete pins[hole];
    delete pinsAt[hole];
  }
  return { ...r, pins, pinsAt, pinsBy };
}
