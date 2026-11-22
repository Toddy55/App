import type { Course, Hole, LatLon, TeeSet } from '../types';
import { distanceM, fromLocal, toLocal } from './geo';

/**
 * Tee boxes. A course can carry its real tees (name, colour, each hole's length
 * off the club scorecard, ratings). Until it does, three standard sets are
 * estimated from the mapped (usually back) tee: middle about 6% shorter,
 * forward about 16% shorter.
 */
export const ESTIMATED_TEES: (TeeSet & { factor: number })[] = [
  { id: 'back', name: 'Back', colour: '#2563eb', factor: 1, estimated: true },
  { id: 'middle', name: 'Middle', colour: '#f1f5f9', factor: 0.94, estimated: true },
  { id: 'forward', name: 'Forward', colour: '#dc2626', factor: 0.84, estimated: true },
];

export const TEE_COLOURS: { name: string; colour: string }[] = [
  { name: 'Black', colour: '#111827' },
  { name: 'Blue', colour: '#2563eb' },
  { name: 'White', colour: '#f1f5f9' },
  { name: 'Yellow', colour: '#facc15' },
  { name: 'Green', colour: '#16a34a' },
  { name: 'Red', colour: '#dc2626' },
  { name: 'Gold', colour: '#d4a017' },
];

export function teesFor(course: Course): TeeSet[] {
  return course.tees?.length ? course.tees : ESTIMATED_TEES;
}

/** Hole length off a tee: the scorecard number if we have it, else estimated from the mapped tee. */
export function teeLength(hole: Hole, tee: TeeSet): number | undefined {
  const card = tee.lengths?.[hole.number];
  if (card) return card;
  const factor = (tee as { factor?: number }).factor ?? 1;
  return hole.lengthM ? Math.round(hole.lengthM * factor) : undefined;
}

/** The line of play from the green back towards (and past) the mapped tee. */
function lineBack(hole: Hole): LatLon[] {
  const pts = [hole.tee, ...(hole.path ?? []).slice(1, -1), hole.green?.centre].filter((p): p is LatLon => !!p);
  return pts.reverse();
}

/**
 * Where a tee `length` metres from the green sits on this hole: walked back
 * along the line of play from the green (round the dogleg), carrying on past
 * the mapped tee if this tee is further back.
 */
export function teeSpot(hole: Hole, length: number): { tee: LatLon; path?: LatLon[] } | null {
  const line = lineBack(hole);
  if (line.length < 2) return null;
  let left = length;
  const kept: LatLon[] = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const seg = distanceM(a, b);
    const last = i === line.length - 1;
    if (left <= seg || last) {
      // On this leg (or past the mapped tee on the last one): go `left` metres from a towards b
      const v = toLocal(a, b);
      const k = left / (seg || 1);
      const tee = fromLocal(a, v.x * k, v.y * k);
      kept.push(tee);
      const path = kept.reverse();
      return { tee, path: path.length > 2 ? path : undefined };
    }
    left -= seg;
    kept.push(b);
  }
  return null;
}

/** The holes as played from a tee: tee spot moved, lengths adjusted. */
export function holesFromTee(holes: Hole[], tee: TeeSet): Hole[] {
  return holes.map((h) => {
    const len = teeLength(h, tee);
    if (!len) return h;
    // Mapped tee is the reference: only move it when this tee is a different length
    const mapped = h.tee && h.green ? Math.round(distanceM(h.tee, h.green.centre)) : undefined;
    const spot = h.green && (h.tee || h.path) && (!mapped || Math.abs(pathLen(h) - len) > 2) ? teeSpot(h, len) : null;
    return { ...h, lengthM: len, ...(spot ? { tee: spot.tee, path: spot.path ?? h.path } : {}) };
  });
}

function pathLen(h: Hole): number {
  const line = lineBack(h);
  let d = 0;
  for (let i = 1; i < line.length; i++) d += distanceM(line[i - 1], line[i]);
  return d;
}

export const totalLength = (holes: Hole[], tee: TeeSet) => holes.reduce((s, h) => s + (teeLength(h, tee) ?? 0), 0);
