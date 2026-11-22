import { describe, expect, it } from 'vitest';
import type { Hole, Round } from '../types';
import { fromLocal } from './geo';
import { patternSummary, shotPatterns } from './patterns';

const O = { lat: -26.63, lon: 152.95 };
const P = (x: number, y: number) => fromLocal(O, x, y);
const holes: Hole[] = [1, 2].map((n) => ({ number: n, par: 4, si: n, tee: P(n * 200, 0), green: { centre: P(n * 200, 380) } }));
const shot = (x: number, y: number, club: string, t: number) => ({ ...P(x, y), club, t });
const round = {
  holes,
  pins: {},
  shots: {
    // drive 220 m, 15 m right; approach finishes 6 m short; chip to 2 m long; putt from 2 m misses 0.5 m right, then holed
    1: [shot(200, 0, 'Driver', 1), shot(215, 220, '8i', 2), shot(200, 374, 'SW', 3), shot(200, 382, 'Putter', 4), shot(200.5, 380, 'Putter', 5)],
    2: [shot(400, 0, 'Driver', 6), shot(390, 230, '9i', 7)],
  },
} as unknown as Round;

describe('shot patterns', () => {
  const p = shotPatterns([round]);
  it('lays drives along the line of play', () => {
    expect(p.drives).toHaveLength(2);
    expect(Math.round(p.drives[0].along)).toBe(220);
    expect(Math.round(p.drives[0].right)).toBe(15);
    expect(Math.round(p.drives[1].right)).toBe(-10);
  });
  it('puts fairway shots, chips and putts around the flag', () => {
    expect(p.fairway).toHaveLength(1);
    expect(Math.round(p.fairway[0].along)).toBe(-6); // short
    expect(p.chips).toHaveLength(1);
    expect(Math.round(p.chips[0].along)).toBe(2); // long
    expect(p.putts).toHaveLength(2);
    expect(p.putts[1].holed).toBe(true);
  });
  it('sums them up', () => {
    expect(patternSummary('drives', p.drives)[0]).toMatch(/Average drive 2\d\d m/);
    expect(patternSummary('putts', p.putts)[0]).toMatch(/1 of 2 putts holed/);
  });
});
