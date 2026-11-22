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

describe('the SEQ course list', () => {
  it('matches list names to map names, without mixing up courses that share a common word', async () => {
    const { sameCourse } = await import('./clubTees');
    expect(sameCourse({ name: 'Ashgrove GC', suburb: 'The Gap' }, { name: 'Ashgrove Golf Club' })).toBe(true);
    expect(sameCourse({ name: 'Keperra Country GC – North', suburb: 'Keperra' }, { name: 'Keperra Golf Course' })).toBe(true);
    expect(sameCourse({ name: 'Gold Coast Country Club', suburb: 'Helensvale' }, { name: 'Gold Coast Burleigh Golf Club', suburb: 'Miami' })).toBe(false);
    expect(sameCourse({ name: 'Mount Coolum GC', suburb: 'Mount Coolum' }, { name: 'Mount Warren Park Golf Club' })).toBe(false);
    expect(sameCourse({ name: 'Sanctuary Cove – The Palms', suburb: 'Hope Island' }, { name: 'Palms Course', suburb: 'Hope Island' })).toBe(true);
    expect(sameCourse({ name: 'Sanctuary Cove – The Pines', suburb: 'Hope Island' }, { name: 'RACV Royal Pines Resort', suburb: 'Benowa' })).toBe(false);
  });

  it('gives the closest scorecard link (Noosa GC for Noosa Golf Club) and every course at a 27-hole club', async () => {
    const { scorecardLinks } = await import('./clubTees');
    expect((await scorecardLinks({ name: 'Noosa Golf Club', suburb: 'Tewantin' })).map((l) => l.id)).toEqual([]); // Noosa GC has no direct link
    expect((await scorecardLinks({ name: 'Noosa Springs', suburb: 'Noosa Heads' })).map((l) => l.id)).toEqual(['noosa-springs-golf-spa-resort']);
    expect((await scorecardLinks({ name: 'Keperra Golf Course', suburb: 'Keperra' })).map((l) => l.id)).toEqual(['keperra-country-gc-old', 'keperra-country-gc-north', 'keperra-country-gc-west']);
  });

  it("adds courses the map doesn't have, with the club's pars and lengths", async () => {
    const { withListedCourses } = await import('./courseCatalog');
    const cat = { v: 1 as const, region: 'SEQ', generated: '', courses: [{ ref: 'way/1', name: 'Ashgrove Golf Club', at: [-27.4, 152.9] as [number, number] }] };
    const out = withListedCourses(cat, {
      v: 1,
      generated: '',
      courses: { 'list/royal-queensland-gc': { id: 'x', name: 'Royal Queensland', tees: [{ n: 'Blue', g: 'm', len: [362, 312], par: [4, 5] }] } },
      extra: { 'list/royal-queensland-gc': { name: 'Royal Queensland GC', suburb: 'Eagle Farm', at: [-27.44, 153.09] } },
    });
    expect(out.courses.map((c) => c.name)).toEqual(['Ashgrove Golf Club', 'Royal Queensland GC']);
    expect(out.courses[1].holes).toEqual([
      { n: 1, par: 4, si: 1, len: 362, se: 1 },
      { n: 2, par: 5, si: 2, len: 312, se: 1 },
    ]);
  });
});
