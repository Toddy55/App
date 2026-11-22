import type { Hole, LatLon, Round } from '../types';
import { bearingDeg, distanceM, toLocal } from './geo';
import { GREENSIDE_M } from './analysis';

/**
 * Every shot of one kind laid on top of each other, as if hit from the same
 * spot at the same target:
 *  - drives: from the tee, along the line of play (how far, how wide)
 *  - fairway shots, chips, putts: where they finished around the flag
 */
export type PatternKind = 'drives' | 'fairway' | 'chips' | 'putts';

export interface PatternShot {
  hole: number;
  club?: string;
  /** Length of the shot, m. */
  dist: number;
  /** Drives: metres along / right of the line of play. Others: where it finished, relative to the flag (+along = long, +right = right). */
  along: number;
  right: number;
  /** For the target charts: how far out it was hit from. */
  from: number;
  /** Putts: holed. */
  holed?: boolean;
}

/** Split into "along the line" and "right of the line" (metres). */
function rel(origin: LatLon, bearing: number, p: LatLon) {
  const { x, y } = toLocal(origin, p);
  const t = (bearing * Math.PI) / 180;
  return { right: x * Math.cos(t) - y * Math.sin(t), along: x * Math.sin(t) + y * Math.cos(t) };
}

export function shotPatterns(rounds: Round[]): Record<PatternKind, PatternShot[]> {
  const out: Record<PatternKind, PatternShot[]> = { drives: [], fairway: [], chips: [], putts: [] };
  for (const r of rounds) {
    for (const [no, shots] of Object.entries(r.shots ?? {})) {
      const n = Number(no);
      const hole = r.holes.find((h) => h.number === n) as Hole | undefined;
      const flag = r.pins?.[n] ?? hole?.green?.centre;
      if (!flag) continue;
      for (let i = 0; i < shots.length; i++) {
        const s = shots[i];
        const putt = /putt/i.test(s.club ?? '');
        const next = shots[i + 1];
        // The last putt went in; the last other shot we can't place
        const end = next ?? (putt ? flag : undefined);
        if (!end) continue;
        const dist = distanceM(s, end);
        if (dist < (putt ? 0.3 : 3)) continue;
        const from = distanceM(s, flag);
        if (i === 0 && hole && hole.par >= 4 && !putt) {
          // Tee shot: judged against the line of play (the dogleg if there is one)
          const aim = hole.path?.[1] ?? hole.green?.centre ?? flag;
          const p = rel(s, bearingDeg(s, aim), end);
          out.drives.push({ hole: n, club: s.club, dist, along: p.along, right: p.right, from });
          continue;
        }
        // Everything else: where it finished around the flag, seen from where it was hit
        const p = rel(flag, bearingDeg(s, flag), end);
        const shot: PatternShot = { hole: n, club: s.club, dist, along: p.along, right: p.right, from };
        if (putt) out.putts.push({ ...shot, holed: !next });
        else if (from <= GREENSIDE_M) out.chips.push(shot);
        else out.fairway.push(shot);
      }
    }
  }
  return out;
}

/** The headline numbers for each kind. */
export function patternSummary(kind: PatternKind, shots: PatternShot[]): string[] {
  if (!shots.length) return [];
  const avg = (f: (s: PatternShot) => number) => shots.reduce((a, s) => a + f(s), 0) / shots.length;
  const lines: string[] = [];
  if (kind === 'drives') {
    const wide = 12;
    const l = shots.filter((s) => s.right < -wide).length;
    const r = shots.filter((s) => s.right > wide).length;
    const mid = shots.length - l - r;
    const side = avg((s) => s.right);
    lines.push(`Average drive ${Math.round(avg((s) => s.dist))} m, longest ${Math.round(Math.max(...shots.map((s) => s.dist)))} m`);
    lines.push(`${mid} of ${shots.length} within ${wide} m of the line · ${l} left · ${r} right`);
    if (Math.abs(side) >= 4) lines.push(`Your drives finish ${Math.round(Math.abs(side))} m ${side > 0 ? 'right' : 'left'} of the line on average: aim ${side > 0 ? 'left' : 'right'} of where you want to finish`);
    return lines;
  }
  const holed = shots.filter((s) => s.holed).length;
  const misses = shots.filter((s) => !s.holed);
  const short = misses.filter((s) => s.along < -0.3).length;
  const long = misses.filter((s) => s.along > 0.3).length;
  const leftN = misses.filter((s) => s.right < -0.3).length;
  const rightN = misses.filter((s) => s.right > 0.3).length;
  const miss = misses.length ? misses.reduce((a, s) => a + Math.hypot(s.along, s.right), 0) / misses.length : 0;
  const unit = (m: number) => (kind === 'putts' ? `${m.toFixed(1)} m` : `${Math.round(m)} m`);
  if (kind === 'putts') {
    lines.push(`${holed} of ${shots.length} putts holed · misses finished ${unit(miss)} away on average`);
    if (misses.length) lines.push(`${short} short · ${long} long · ${leftN} left · ${rightN} right`);
    if (misses.length >= 3 && short > long * 2) lines.push('Mostly short: give them a chance, aim to finish 30–40 cm past');
    else if (misses.length >= 3 && long > short * 2) lines.push('Mostly long: ease the pace on the quick ones, especially downhill');
  } else {
    lines.push(`${shots.length} shots from an average of ${Math.round(avg((s) => s.from))} m · finished ${unit(miss)} from the flag on average`);
    lines.push(`${short} short · ${long} long · ${leftN} left · ${rightN} right`);
    if (misses.length >= 3 && short > long * 2) lines.push(`Mostly short of the flag: take ${kind === 'chips' ? 'a bit more carry' : 'one more club'}`);
    else if (misses.length >= 3 && long > short * 2) lines.push(`Mostly long: ${kind === 'chips' ? 'land it shorter and let it release' : 'one less club, or a smoother swing'}`);
  }
  return lines;
}
