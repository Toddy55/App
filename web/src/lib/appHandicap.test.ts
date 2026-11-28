import { describe, expect, it } from 'vitest';
import { appHandicap, countingRule, indexFrom, roundDiff } from './appHandicap';
import type { Course, Hole, Round } from '../types';

const holes18: Hole[] = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: i % 4 === 0 ? 3 : i % 4 === 1 ? 5 : 4, si: i + 1 }));
const PAR = holes18.reduce((s, h) => s + h.par, 0); // 72
const course: Course = { id: 'c', name: 'Test GC', holes: holes18, source: 'manual', updatedAt: 1, tees: [{ id: 'w', name: 'White', slopeRating: 126, scratchRating: 71.2 }] };

let n = 0;
function round(strokes: number[], opts: Partial<Round> = {}): Round {
  n++;
  const holes = opts.holes ?? holes18;
  return {
    id: `r${n}`,
    courseId: 'c',
    courseName: 'Test GC',
    date: '2026-11-01',
    format: 'stableford',
    holes,
    players: [{ id: 'me', name: 'Toddy', gaHandicap: 18, dailyHandicap: 20, playingHandicap: 20 }],
    meId: 'me',
    scores: { me: Object.fromEntries(holes.map((h, i) => [h.number, strokes[i]])) },
    stats: {},
    shots: {},
    pins: {},
    options: { allowance: 100, skinsNet: false, skinsCarryOver: true },
    completed: true,
    teeName: 'White',
    startedAt: n * 86400000,
    finishedAt: n * 86400000 + 4 * 3600000,
    ...opts,
  };
}

describe('handicap from your rounds', () => {
  it('uses the WHS table: best 1 − 2 with 3 rounds … best 8 of 20', () => {
    expect(countingRule(2)).toBeNull();
    expect(countingRule(3)).toEqual({ use: 1, adj: -2 });
    expect(countingRule(6)).toEqual({ use: 2, adj: -1 });
    expect(countingRule(12)).toEqual({ use: 4, adj: 0 });
    expect(countingRule(25)).toEqual({ use: 8, adj: 0 });
    // 20 scores 1..20: best 8 average 4.5
    expect(indexFrom(Array.from({ length: 20 }, (_, i) => i + 1))!.index).toBe(4.5);
    // only the last 20 count
    expect(indexFrom([0, 0, 0, ...Array.from({ length: 20 }, (_, i) => i + 1)])!.index).toBe(4.5);
  });

  it('works out a differential from the tee ratings, capping blow-up holes at net double bogey', () => {
    // A 10 on hole 1 (par 3, SI 1, gets 2 strokes with a 20 handicap): counts as 3 + 2 + 2 = 7
    const strokes = holes18.map((h) => h.par + 1);
    strokes[0] = 10;
    const d = roundDiff(round(strokes), 'me', course, null)!;
    expect(d.gross).toBe(PAR + 18 + 6);
    expect(d.adjusted).toBe(PAR + 18 + 3);
    expect(d.diff).toBeCloseTo(Math.round(((113 / 126) * (PAR + 21 - 71.2)) * 10) / 10, 5);
    expect(d.estimatedRatings).toBeUndefined();
  });

  it("fills holes not scored with net double bogey, but won't count a round with fewer than 14 holes", () => {
    const strokes = holes18.map((h) => h.par + 1);
    const most = [...strokes.slice(0, 15), 0, 0, 0];
    const d = roundDiff(round(most), 'me', course, null)!;
    expect(d.adjusted).toBeGreaterThan(d.gross);
    expect(roundDiff(round([...strokes.slice(0, 13), 0, 0, 0, 0, 0]), 'me', course, null)).toBeNull();
  });

  it('counts a 9 with half the scratch rating plus the expected score for the other 9', () => {
    const nine = holes18.slice(0, 9);
    const strokes = nine.map((h) => h.par + 1);
    const d = roundDiff(round(strokes, { holes: nine, players: [{ id: 'me', name: 'Toddy', gaHandicap: 14, dailyHandicap: 8, playingHandicap: 8 }] }), 'me', course, 14)!;
    const par9 = nine.reduce((s, h) => s + h.par, 0);
    expect(d.diff).toBeCloseTo(Math.round(((113 / 126) * (par9 + 9 - 35.6) + 0.52 * 14 + 1.2) * 10) / 10, 5);
  });

  it("leaves out Ambrose and 4BBB, unfinished rounds, and other people's cards", () => {
    const s = holes18.map((h) => h.par + 1);
    expect(roundDiff(round(s, { format: 'ambrose' }), 'me', course, null)).toBeNull();
    expect(roundDiff(round(s, { format: 'fourball' }), 'me', course, null)).toBeNull();
    expect(roundDiff(round(s, { completed: false }), 'me', course, null)).toBeNull();
    expect(roundDiff(round(s), 'jarrod', course, null)).toBeNull();
  });

  it('gives an index after 3 rounds and keeps it up to date, newest round first', () => {
    const scores = [90, 88, 95, 85];
    const rounds = scores.map((total) => {
      const base = holes18.map((h) => h.par);
      let extra = total - PAR;
      for (let i = 0; extra > 0; i = (i + 1) % 18, extra--) base[i]++;
      return round(base);
    });
    expect(appHandicap('me', rounds.slice(0, 2), [course]).index).toBeNull();
    const three = appHandicap('me', rounds.slice(0, 3), [course]);
    const best = Math.min(...three.rounds.map((r) => r.diff));
    expect(three.index).toBe(Math.round((best - 2) * 10) / 10);
    const four = appHandicap('me', rounds, [course]);
    expect(four.rounds[0].roundId).toBe(rounds[3].id);
    expect(four.rounds.filter((r) => r.used)).toHaveLength(1);
    expect(four.index).toBeLessThan(three.index!); // the 85 is the new best
  });

  it('works without ratings (as slope 113, scratch = par) and says so', () => {
    const d = roundDiff(round(holes18.map((h) => h.par + 1), { teeName: 'Blue' }), 'me', { ...course, tees: [] }, null)!;
    expect(d.estimatedRatings).toBe(true);
    expect(d.diff).toBe(18);
  });
});
