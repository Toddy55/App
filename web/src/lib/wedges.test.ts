import { describe, expect, it } from 'vitest';
import type { Hole, Round, Settings } from '../types';
import { fromLocal } from './geo';
import { clubDistances } from './analysis';
import { advise, buildBag } from './caddy';

const O = { lat: -26.63, lon: 152.95 };
const P = (x: number, y: number) => fromLocal(O, x, y);
const hole: Hole = { number: 1, par: 4, si: 1, tee: P(0, 0), green: { centre: P(0, 400) } };

describe('wedge distances: full swings vs around the green', () => {
  // SW: three full 80 m shots, plus chips of 20 m and 15 m from beside the green
  const shots = [
    [P(0, 230), 'Driver'], [P(0, 320), 'SW'], [P(0, 400), 'Putter'],
  ] as const;
  const mk = (pts: [{ lat: number; lon: number }, string][]) => pts.map(([p, club], i) => ({ ...p, club, t: i }));
  const round = {
    holes: [hole],
    shots: {
      1: [
        ...mk([[P(0, 0), 'Driver'], [P(0, 240), 'SW'], [P(0, 380), 'Putter']]),
      ],
    },
    pins: {},
  } as unknown as Round;
  void shots;
  const rounds = [0, 1, 2].map((k) => ({
    ...round,
    shots: { 1: mk([[P(0, 0), 'Driver'], [P(0, 320 - k), 'SW'], [P(0, 400 - k), 'Putter']]) },
  })) as unknown as Round[];
  // greenside: 30 m out, chipped 20 m; 25 m out, chipped 15 m
  rounds.push({ ...round, shots: { 1: mk([[P(0, 370), 'SW'], [P(0, 390), 'Putter']]) } } as unknown as Round);
  rounds.push({ ...round, shots: { 1: mk([[P(0, 375), 'SW'], [P(0, 390), 'Putter']]) } } as unknown as Round);

  it('keeps chips out of the full-swing average', () => {
    const sw = clubDistances(rounds).find((c) => c.club === 'SW')!;
    expect(sw.n).toBe(3);
    expect(Math.round(sw.avg)).toBe(80);
    expect(sw.short?.n).toBe(2);
    expect(Math.round(sw.short!.avg)).toBe(18);
  });
});

describe('caddie inside a full wedge', () => {
  const settings: Settings = { me: { id: 'me', name: 'T', gaHandicap: 14 }, units: 'm', clubs: ['Driver', '7i', 'PW', 'SW'], myDistances: { SW: 80, PW: 100 } };
  const bag = buildBag(settings, [], 14);
  it('calls a part swing, not a full wedge that flies the green', () => {
    const a = advise({ hole, from: P(0, 350), bag, cond: {}, tend: { lat: 0, long: 0, notes: [] }, handicap: 14, mood: { caution: 0.12 }, units: 'm' })!;
    expect(a.best.club.club).toBe('SW');
    expect(a.best.club.partial).toBeCloseTo(50 / 80, 1);
    expect(a.headline).toMatch(/SW · ½ swing/);
    expect(a.lines[0]).toMatch(/half swing: about 6[0-9]% of your full SW \(80 m, your distance\)/);
  });
});
