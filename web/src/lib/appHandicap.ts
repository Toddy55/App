import type { Course, Round } from '../types';
import { strokesByHole } from './handicap';

/**
 * A handicap kept up to date from the rounds scored in the app, worked out
 * the World Handicap System way (as Golf Australia does):
 *
 *   - Each hole counts at most net double bogey (par + 2 + strokes received).
 *   - Score differential = (113 ÷ slope) × (adjusted gross − scratch rating).
 *   - A 9-hole round counts as its differential plus the expected differential
 *     for the other 9 (0.52 × index + 1.2).
 *   - Index = average of the best 8 of the last 20 (fewer at the start, with
 *     the usual adjustments), capped so it can't jump more than 3 (softly) or
 *     5 (hard) above its lowest in the last year. Max 54.
 *
 * It's not an official GA Handicap: it doesn't see rounds scored elsewhere,
 * the daily course conditions adjustment (PCC) or committee decisions.
 */

/** Formats where everyone plays their own ball out every hole, so the score is a fair one for a handicap. */
const COUNTING: Round['format'][] = ['stroke', 'stableford', 'par', 'matchplay', 'skins'];

export interface HcpRound {
  roundId: string;
  date: string;
  courseName: string;
  holes: number;
  gross: number;
  /** Gross with each hole capped at net double bogey (and unplayed holes filled in at it). */
  adjusted: number;
  /** 18-hole score differential. */
  diff: number;
  slope: number;
  scratch: number;
  /** No ratings known for the tee: worked out as if slope 113 and scratch = par. */
  estimatedRatings?: boolean;
  /** One of the differentials the index is made from right now. */
  used?: boolean;
  /** The index after this round. */
  indexAfter: number | null;
  at: number;
}

export interface AppHandicap {
  index: number | null;
  /** Newest first. */
  rounds: HcpRound[];
  /** How many of the last 20 count, and the adjustment applied (e.g. best 1 − 2.0 with 3 rounds). */
  counting: number;
  adjustment: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** How many of the lowest differentials count, and the adjustment, by how many there are (WHS table). */
export function countingRule(n: number): { use: number; adj: number } | null {
  if (n < 3) return null;
  if (n === 3) return { use: 1, adj: -2 };
  if (n === 4) return { use: 1, adj: -1 };
  if (n === 5) return { use: 1, adj: 0 };
  if (n === 6) return { use: 2, adj: -1 };
  if (n <= 8) return { use: 2, adj: 0 };
  if (n <= 11) return { use: 3, adj: 0 };
  if (n <= 14) return { use: 4, adj: 0 };
  if (n <= 16) return { use: 5, adj: 0 };
  if (n <= 18) return { use: 6, adj: 0 };
  if (n === 19) return { use: 7, adj: 0 };
  return { use: 8, adj: 0 };
}

/** Index from up to the last 20 differentials (oldest first). */
export function indexFrom(diffs: number[]): { index: number; used: number[] } | null {
  const last = diffs.slice(-20);
  const rule = countingRule(last.length);
  if (!rule) return null;
  const order = last.map((d, i) => ({ d, i })).sort((a, b) => a.d - b.d).slice(0, rule.use);
  const avg = order.reduce((s, x) => s + x.d, 0) / rule.use;
  const offset = diffs.length - last.length;
  return { index: Math.min(54, r1(avg + rule.adj)), used: order.map((x) => x.i + offset) };
}

/** The tee's ratings for a round: saved on it, else the course's tee of that name, else the course's. */
function ratingsFor(round: Round, course?: Course): { slope?: number; scratch?: number } {
  if (round.slope || round.scratch) return { slope: round.slope, scratch: round.scratch };
  const tee = course?.tees?.find((t) => t.name === round.teeName);
  return { slope: tee?.slopeRating ?? course?.slopeRating, scratch: tee?.scratchRating ?? course?.scratchRating };
}

/** One round's 18-hole differential for a player, or null if it can't count. */
export function roundDiff(round: Round, playerId: string, course: Course | undefined, indexSoFar: number | null): Omit<HcpRound, 'indexAfter' | 'used'> | null {
  if (!round.completed || !COUNTING.includes(round.format)) return null;
  const p = round.players.find((x) => x.id === playerId);
  const card = round.scores[playerId];
  if (!p || !card) return null;
  const holes = round.holes;
  const nine = holes.length <= 9;
  // Enough of the round played to count (WHS: 14 of 18, 7 of 9)
  const scored = holes.filter((h) => card[h.number] > 0);
  if (scored.length < (nine ? 7 : 14)) return null;
  const strokes = strokesByHole(p.dailyHandicap, holes);
  let gross = 0;
  let adjusted = 0;
  for (const h of holes) {
    const ndb = h.par + 2 + (strokes[h.number] ?? 0);
    const g = card[h.number];
    if (g > 0) gross += g;
    adjusted += g > 0 ? Math.min(g, ndb) : ndb;
  }
  const par = holes.reduce((s, h) => s + h.par, 0);
  const { slope: s0, scratch: c0 } = ratingsFor(round, course);
  const estimatedRatings = !s0 || !c0;
  const slope = s0 && s0 > 0 ? s0 : 113;
  // Ratings are for 18 holes: a 9 uses half the scratch rating
  const scratch = c0 ? (nine ? c0 / 2 : c0) : par;
  let diff = (113 / slope) * (adjusted - scratch);
  if (nine) diff += 0.52 * (indexSoFar ?? p.gaHandicap) + 1.2;
  return {
    roundId: round.id,
    date: round.date,
    courseName: round.courseName,
    holes: holes.length,
    gross,
    adjusted,
    diff: r1(diff),
    slope,
    scratch: c0 ?? par * (nine ? 2 : 1),
    ...(estimatedRatings ? { estimatedRatings } : {}),
    at: round.finishedAt ?? round.startedAt,
  };
}

/** A player's handicap from every round they've played in the app. */
export function appHandicap(playerId: string, rounds: Round[], courses: Course[]): AppHandicap {
  const byId = new Map(courses.map((c) => [c.id, c]));
  const list = [...rounds].filter((r) => r.completed && !r.scoreHoles).sort((a, b) => (a.finishedAt ?? a.startedAt) - (b.finishedAt ?? b.startedAt));
  const out: HcpRound[] = [];
  const diffs: number[] = [];
  const history: { at: number; index: number }[] = [];
  let index: number | null = null;
  const YEAR = 365 * 24 * 3600 * 1000;
  for (const r of list) {
    const d = roundDiff(r, playerId, byId.get(r.courseId), index);
    if (!d) continue;
    diffs.push(d.diff);
    const calc = indexFrom(diffs);
    let next = calc?.index ?? null;
    // Caps (once there are 20 scores): no more than 3 above the year's low before slowing, 5 at most
    if (next != null && diffs.length >= 20) {
      const low = Math.min(...history.filter((x) => d.at - x.at <= YEAR).map((x) => x.index));
      if (Number.isFinite(low)) {
        if (next - low > 3) next = r1(low + 3 + (next - low - 3) / 2);
        next = Math.min(next, r1(low + 5));
      }
    }
    index = next;
    if (index != null) history.push({ at: d.at, index });
    out.push({ ...d, indexAfter: index });
  }
  const calc = indexFrom(diffs);
  const used = new Set(calc?.used ?? []);
  const rule = countingRule(Math.min(20, diffs.length));
  return {
    index,
    rounds: out.map((x, i) => ({ ...x, ...(used.has(i) ? { used: true } : {}) })).reverse(),
    counting: rule?.use ?? 0,
    adjustment: rule?.adj ?? 0,
  };
}
