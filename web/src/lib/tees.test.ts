import { describe, expect, it } from 'vitest';
import type { Hole } from '../types';
import { fromLocal, toLocal, distanceM } from './geo';
import { ESTIMATED_TEES, holesFromTee, teeSpot } from './tees';

const O = { lat: -26.63, lon: 152.95 };
const P = (x: number, y: number) => fromLocal(O, x, y);
const at = (p: { lat: number; lon: number }) => {
  const v = toLocal(O, p);
  return [Math.round(v.x), Math.round(v.y)];
};
const straight: Hole = { number: 1, par: 4, si: 1, tee: P(0, 0), green: { centre: P(0, 360) }, lengthM: 360 };
// Dogleg right: 250 m north, then 150 m east
const dogleg: Hole = { number: 2, par: 4, si: 2, tee: P(0, 0), green: { centre: P(150, 250) }, path: [P(0, 0), P(0, 250), P(150, 250)], lengthM: 400 };

describe('tee boxes', () => {
  it('moves a shorter tee forward along the line of play', () => {
    expect(at(teeSpot(straight, 300)!.tee)).toEqual([0, 60]);
  });
  it('puts a longer tee behind the mapped one', () => {
    expect(at(teeSpot(straight, 400)!.tee)).toEqual([0, -40]);
  });
  it('follows the dogleg', () => {
    const s = teeSpot(dogleg, 300)!;
    expect(at(s.tee)).toEqual([0, 100]);
    // The path still turns at the corner
    expect(s.path!.map(at)).toEqual([[0, 100], [0, 250], [150, 250]]);
  });
  it('uses scorecard lengths, else estimates', () => {
    const white = { id: 'w', name: 'White', lengths: { 1: 330 } };
    const [h] = holesFromTee([straight], white);
    expect(h.lengthM).toBe(330);
    expect(Math.round(distanceM(h.tee!, h.green!.centre))).toBe(330);
    const [fwd] = holesFromTee([straight], ESTIMATED_TEES[2]);
    expect(fwd.lengthM).toBe(302); // about 16% shorter
    const [back] = holesFromTee([straight], ESTIMATED_TEES[0]);
    expect(at(back.tee!)).toEqual([0, 0]);
  });
});
