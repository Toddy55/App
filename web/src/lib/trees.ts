import type { LatLon } from '../types';
import { distanceM, fromLocal, pointInPolygon, toLocal } from './geo';

/**
 * Trees between you and the target. The ball only meets trees where it's
 * still low: just after you hit it and as it comes down. In the middle it's
 * well over them. So a shot is "blocked" when its low parts pass through trees.
 */
const TREE_TOP_M = 13;

/** Ball height (m) at fraction f of the way, for a shot of `dist` metres. */
export function ballHeight(dist: number, f: number, punch = false): number {
  // Apex grows with distance: a 200 m drive peaks around 28 m, a 120 m iron around 22 m, a 60 m pitch around 12 m
  const apex = punch ? 5 : Math.min(30, 6 + dist * 0.12);
  return 4 * apex * f * (1 - f);
}

export interface TreeHit {
  /** Metres from the start where the ball meets the trees. */
  at: number;
}

/** First spot where a path at ball height runs through trees (null = clear). */
export function treesOnPath(path: LatLon[], trees: LatLon[][], dist: number, opts: { skipStartM?: number; punch?: boolean } = {}): TreeHit | null {
  if (!trees.length || path.length < 2) return null;
  // Lengths along the path
  const seg: number[] = [0];
  for (let i = 1; i < path.length; i++) seg.push(seg[i - 1] + distanceM(path[i - 1], path[i]));
  const total = seg[seg.length - 1] || 1;
  const skip = opts.skipStartM ?? 6;
  const step = Math.max(2, total / 80);
  for (let d = skip; d < total - 3; d += step) {
    const f = d / total;
    if (ballHeight(dist, f, opts.punch) > TREE_TOP_M) continue;
    // Point d metres along the path
    let i = 1;
    while (i < seg.length - 1 && seg[i] < d) i++;
    const k = (d - seg[i - 1]) / (seg[i] - seg[i - 1] || 1);
    const p = { lat: path[i - 1].lat + (path[i].lat - path[i - 1].lat) * k, lon: path[i - 1].lon + (path[i].lon - path[i - 1].lon) * k };
    if (trees.some((t) => pointInPolygon(p, t))) return { at: d };
  }
  return null;
}

/**
 * A shot that curves: `bend` > 0 bulges right of the straight line (starts
 * right, comes back left: right to left), < 0 bulges left (left to right).
 */
export function curvedPath(from: LatLon, to: LatLon, bend: number, n = 24): LatLon[] {
  const b = toLocal(from, to);
  const len = Math.hypot(b.x, b.y) || 1;
  // Right of the line of flight
  const rx = b.y / len;
  const ry = -b.x / len;
  const c = { x: b.x / 2 + rx * bend * len, y: b.y / 2 + ry * bend * len };
  const out: LatLon[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = 2 * (1 - t) * t * c.x + t * t * b.x;
    const y = 2 * (1 - t) * t * c.y + t * t * b.y;
    out.push(fromLocal(from, x, y));
  }
  return out;
}

export type TreePlay =
  | { kind: 'clear' }
  | { kind: 'shape'; dir: 'rtl' | 'ltr'; bend: number; blockedAt: number; path: LatLon[] }
  | { kind: 'punch'; blockedAt: number }
  | { kind: 'chip'; to: LatLon; blockedAt: number };

/** How to get past the trees from `from` to `to`: straight, curve it, keep it low, or chip out. */
export function treePlay(from: LatLon, to: LatLon, trees: LatLon[][]): TreePlay {
  const dist = distanceM(from, to);
  const near = trees.filter((t) => t.some((p) => distanceM(p, from) < dist + 60));
  // Standing in the trees yourself: the first few metres are always through branches
  const inTrees = near.some((t) => pointInPolygon(from, t));
  const skip = inTrees ? 0 : 6;
  const straight = treesOnPath([from, to], near, dist, { skipStartM: skip });
  if (!straight) return { kind: 'clear' };
  // Try curving it either way, gentlest first (a big hook or slice is hard to pull off)
  if (!inTrees) {
    for (const bend of [0.07, 0.11, 0.15]) {
      for (const dir of ['rtl', 'ltr'] as const) {
        const path = curvedPath(from, to, dir === 'rtl' ? bend : -bend);
        if (!treesOnPath(path, near, dist, { skipStartM: skip })) return { kind: 'shape', dir, bend, blockedAt: straight.at, path };
      }
    }
  }
  // Trees only right in front and the rest clear: a low punch under the branches
  if (!inTrees && straight.at < 25 && !treesOnPath([from, to], near, dist, { skipStartM: 30 })) return { kind: 'punch', blockedAt: straight.at };
  return { kind: 'chip', to, blockedAt: straight.at };
}

/**
 * Taking your medicine: the best spot to chip out to, short and low, clear of
 * the trees and as close to the flag as you can get.
 */
export function chipOutSpot(from: LatLon, pin: LatLon, trees: LatLon[][], okLie: (p: LatLon) => boolean): { to: LatLon; dist: number; leaves: number } | null {
  const toPin = toLocal(from, pin);
  const base = Math.atan2(toPin.x, toPin.y);
  const inTrees = trees.some((t) => pointInPolygon(from, t));
  let best: { to: LatLon; dist: number; leaves: number; score: number } | null = null;
  for (const deg of [0, 20, -20, 40, -40, 60, -60, 80, -80, 100, -100]) {
    for (const d of [20, 30, 45, 60, 80]) {
      const a = base + (deg * Math.PI) / 180;
      const to = fromLocal(from, Math.sin(a) * d, Math.cos(a) * d);
      if (!okLie(to)) continue;
      if (trees.some((t) => pointInPolygon(to, t))) continue;
      // A chip-out stays low: the line has to be clear, apart from scooting out under the branches you're standing in
      if (treesOnPath([from, to], trees, d, { skipStartM: inTrees ? 30 : 2, punch: true })) continue;
      const leaves = distanceM(to, pin);
      const score = leaves + Math.abs(deg) * 0.15;
      if (!best || score < best.score) best = { to, dist: d, leaves, score };
    }
  }
  return best ? { to: best.to, dist: best.dist, leaves: best.leaves } : null;
}
