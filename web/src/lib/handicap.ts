import type { Format, Hole } from '../types';

/**
 * Golf Australia Daily Handicap:
 *   DH = GA Handicap × (Slope Rating ÷ 113) + (Scratch Rating − Par)
 * Rounded to the nearest whole number (0.5 rounds up).
 * If the course ratings aren't known we fall back to the GA Handicap itself.
 */
export function dailyHandicap(
  ga: number,
  par: number,
  slope?: number,
  scratch?: number,
  holesPlayed = 18,
): number {
  const s = slope && slope > 0 ? slope : 113;
  const cr = scratch ?? par;
  let dh = ga * (s / 113) + (cr - par);
  if (holesPlayed <= 9) dh = dh / 2;
  return roundHalfUp(dh);
}

export function roundHalfUp(n: number): number {
  return Math.sign(n) * Math.floor(Math.abs(n) + 0.5);
}

/** Default handicap allowance % by format (editable per round to match your club). */
export const DEFAULT_ALLOWANCE: Record<Format, number> = {
  stroke: 100,
  stableford: 100,
  par: 100,
  matchplay: 100,
  fourball: 85,
  ambrose: 100,
  skins: 100,
};

export function playingHandicap(daily: number, allowancePct: number): number {
  return roundHalfUp((daily * allowancePct) / 100);
}

/**
 * Ambrose team handicap (Golf Australia method):
 *   2 person: combined daily handicaps ÷ 4
 *   3 person: ÷ 6
 *   4 person: ÷ 8
 * Kept to one decimal place, as is usual on Ambrose results sheets.
 */
export function ambroseTeamHandicap(dailies: number[]): number {
  const n = dailies.length;
  if (n === 0) return 0;
  const sum = dailies.reduce((a, b) => a + b, 0);
  return Math.round((sum / (2 * n)) * 10) / 10;
}

/**
 * Strokes received on each hole for a playing handicap, allocated by stroke
 * index across the holes being played. Plus handicaps give strokes back on
 * the easiest holes.
 */
export function strokesByHole(handicap: number, holes: Hole[]): Record<number, number> {
  const out: Record<number, number> = {};
  const n = holes.length;
  if (n === 0) return out;
  // Rank the holes being played by stroke index (handles 9-hole rounds).
  const ranked = [...holes].sort((a, b) => a.si - b.si || a.number - b.number);
  const h = Math.round(handicap);
  if (h >= 0) {
    const base = Math.floor(h / n);
    const extra = h % n;
    ranked.forEach((hole, i) => {
      out[hole.number] = base + (i < extra ? 1 : 0);
    });
  } else {
    const plus = -h;
    const base = Math.floor(plus / n);
    const extra = plus % n;
    // easiest holes first
    [...ranked].reverse().forEach((hole, i) => {
      out[hole.number] = -(base + (i < extra ? 1 : 0)) || 0;
    });
  }
  return out;
}

export function stablefordPoints(gross: number, par: number, strokes: number): number {
  return Math.max(0, 2 + par + strokes - gross);
}
