import type { Hole, LatLon, Round, Shot } from '../types';
import { toLocal } from './geo';
import { clubFromSpeech } from './clubSpeech';

/**
 * "Hey Siri, mark shot": an iPhone Shortcut grabs your location and posts it
 * to marks/<your mark key> while the phone stays in your pocket. When you next
 * look at the round, those spots drop into the right holes as shots.
 */
export interface SiriMark {
  id: string;
  lat: number;
  lon: number;
  /** When it was marked (from the server's push id), ms. */
  t: number;
  /** The club you told Siri ("seven iron"), if you did. */
  club?: string;
}

const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

/** Firebase push ids start with the server time they were made (8 chars, ms). */
export function pushIdTime(id: string): number | null {
  if (id.length < 8) return null;
  let t = 0;
  for (let i = 0; i < 8; i++) {
    const v = PUSH_CHARS.indexOf(id[i]);
    if (v < 0) return null;
    t = t * 64 + v;
  }
  return t;
}

/** Metres from p to the line of play (tee → dogleg → green). */
function distToHole(h: Hole, p: LatLon): number {
  const line = [h.tee, ...(h.path ?? []), h.green?.centre].filter((x): x is LatLon => !!x);
  if (line.length < 2) return line.length ? Math.hypot(...Object.values(toLocal(line[0], p))) : Infinity;
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = toLocal(p, line[i]);
    const b = toLocal(p, line[i + 1]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    const k = Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2));
    best = Math.min(best, Math.hypot(a.x + k * dx, a.y + k * dy));
  }
  return best;
}

/**
 * Which hole a spot belongs to. Prefers the hole you were on (then the next
 * ones) when the spot is near it, so a shot that strays onto the next fairway
 * still counts on the right hole; otherwise the nearest hole.
 */
export function holeForSpot(holes: Hole[], p: LatLon, currentHole: number, currentHasShots = false): number | null {
  const mapped = holes.filter((h) => h.tee || h.green);
  if (!mapped.length) return null;
  const order = [...holes].sort((a, b) => a.number - b.number).map((h) => h.number);
  const start = Math.max(0, order.indexOf(currentHole));
  const ahead = [...order.slice(start), ...order.slice(0, start)];
  const byNo = (n: number) => holes.find((x) => x.number === n);
  const onTee = (h: Hole | undefined) => !!h?.tee && Math.hypot(...Object.values(toLocal(h.tee, p))) <= 30;
  // On a tee box: the hole you're about to start (the next one once you've hit shots on this one)
  if (!currentHasShots && onTee(byNo(ahead[0]))) return ahead[0];
  for (const n of ahead.slice(currentHasShots ? 1 : 0, 3)) if (onTee(byNo(n))) return n;
  // Otherwise stay on the hole you're playing (or the next one) if the spot's near it
  const near = 70;
  for (const n of ahead.slice(0, 2)) {
    const h = byNo(n);
    if (h && distToHole(h, p) <= near) return n;
  }
  let best: { n: number; d: number } | null = null;
  for (const h of mapped) {
    const d = distToHole(h, p);
    if (!best || d < best.d) best = { n: h.number, d };
  }
  return best && best.d < 400 ? best.n : null;
}

/** The hole of the latest shot before `t` (or the first hole). */
function holeAt(round: Round, t: number): number {
  let latest: { n: number; t: number } | null = null;
  for (const [n, shots] of Object.entries(round.shots ?? {}))
    for (const s of shots) if (s.t <= t && (!latest || s.t > latest.t)) latest = { n: Number(n), t: s.t };
  return latest?.n ?? round.holes[0]?.number ?? 1;
}

/**
 * Add any new marks to the round as shots. Returns the updated round and
 * where each went (for the "Shot marked on the 5th" pop-up).
 */
export function applySiriMarks(round: Round, marks: SiriMark[], holes: Hole[], clubs: string[] = []): { round: Round; added: { hole: number; t: number; club?: string }[] } {
  const done = new Set(round.siriMarks ?? []);
  const fresh = marks.filter((m) => !done.has(m.id) && m.t >= round.startedAt - 60_000 && !round.completed).sort((a, b) => a.t - b.t);
  if (!fresh.length) return { round, added: [] };
  const next: Round = { ...round, shots: { ...round.shots }, siriMarks: [...done] };
  const added: { hole: number; t: number; club?: string }[] = [];
  for (const m of fresh) {
    next.siriMarks!.push(m.id);
    const cur = holeAt(next, m.t);
    const n = holeForSpot(holes, m, cur, (next.shots[cur] ?? []).length > 0);
    if (n == null) continue;
    const club = m.club ? clubFromSpeech(m.club, clubs) : undefined;
    const shot: Shot = { lat: m.lat, lon: m.lon, t: m.t, voice: true, ...(club ? { club } : {}) };
    next.shots[n] = [...(next.shots[n] ?? []), shot].sort((a, b) => a.t - b.t);
    added.push({ hole: n, t: m.t, club });
  }
  return { round: next, added };
}
