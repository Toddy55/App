import { describe, expect, it } from 'vitest';
import { colourFor, toTeeSets, type CourseTees } from './clubTees';
import { holesFromTee } from './tees';
import type { Hole } from '../types';

const ct: CourseTees = {
  id: '1',
  name: 'Test GC',
  tees: [
    { n: 'Red', g: 'f', cr: 72, sr: 125, len: [300, 280], par: [5, 4] },
    { n: 'White', g: 'm', cr: 69, sr: 120, len: [330, 300], par: [4, 4] },
    { n: 'Blue', g: 'm', cr: 71, sr: 124, len: [360, 320], par: [4, 4] },
    { n: 'Women', g: 'f', cr: 75, sr: 130, len: [340, 310], par: [5, 4] },
    { n: 'Women', g: 'f', cr: 74, sr: 128, len: [320, 300], par: [5, 4] },
  ],
};

describe('club tees', () => {
  it("lists men's longest first, then women's, with names and colours that say which is which", () => {
    const t = toTeeSets(ct, [1, 2]);
    expect(t.map((x) => x.name)).toEqual(['Blue', 'White', 'Women', 'Women', 'Red (women)']);
    expect(new Set(t.map((x) => x.id)).size).toBe(5);
    expect(t[0]).toMatchObject({ colour: '#2563eb', slopeRating: 124, scratchRating: 71, lengths: { 1: 360, 2: 320 }, club: true });
    expect(t[4].women).toBe(true);
    expect(colourFor('Blue/White')).toBe('#2563eb');
    expect(colourFor("Clayton's")).toBeUndefined();
  });

  it("plays the tee's pars as well as its lengths (women's par 5 on a men's par 4)", () => {
    const holes: Hole[] = [
      { number: 1, par: 4, si: 1, lengthM: 360 },
      { number: 2, par: 4, si: 2, lengthM: 320 },
    ];
    const red = toTeeSets(ct, [1, 2]).find((x) => x.name === 'Red (women)')!;
    const played = holesFromTee(holes, red);
    expect(played.map((h) => [h.par, h.lengthM])).toEqual([
      [5, 300],
      [4, 280],
    ]);
  });
});
