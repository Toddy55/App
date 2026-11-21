import { describe, expect, it } from 'vitest';
import { catalogToCourse, searchCatalog, type Catalog } from './courseCatalog';
import { parFromLength } from './courses';

const cat: Catalog = {
  v: 1,
  region: 'South East Queensland',
  generated: '2026-11-21',
  courses: [
    { ref: 'way/1', name: 'Nambour Golf Club', suburb: 'Nambour', at: [-26.62, 152.95], holes: [{ n: 1, par: 4, si: 7, len: 350, tee: [-26.62, 152.95], g: [-26.617, 152.95], poly: [[-26.617, 152.95], [-26.617, 152.951], [-26.616, 152.951]] }] },
    { ref: 'way/2', name: 'Royal Queensland Golf Club', suburb: 'Eagle Farm', at: [-27.43, 153.07] },
    { ref: 'way/3', name: 'Palmwoods Golf Course', suburb: 'Palmwoods', at: [-26.68, 152.96] },
    { ref: 'way/4', name: "Victoria Park Golf Complex", suburb: 'Herston', at: [-27.45, 153.02] },
    { ref: 'way/5', name: 'Headland Golf Club', suburb: 'Buderim', at: [-26.68, 153.12] },
  ],
};

describe('built-in course list', () => {
  it('matches as you type, by name or town', () => {
    expect(searchCatalog(cat, 'nam').map((c) => c.name)).toEqual(['Nambour Golf Club']);
    expect(searchCatalog(cat, 'royal q').map((c) => c.name)).toEqual(['Royal Queensland Golf Club']);
    expect(searchCatalog(cat, 'buderim').map((c) => c.name)).toEqual(['Headland Golf Club']);
    expect(searchCatalog(cat, 'vic park').map((c) => c.name)).toEqual(['Victoria Park Golf Complex']);
    expect(searchCatalog(cat, 'golf')).toEqual([]); // "golf" alone is too generic to match
    expect(searchCatalog(cat, 'zzz')).toEqual([]);
  });
  it('turns a built-in course into a playable course', () => {
    const c = catalogToCourse(cat.courses[0]);
    expect(c.holes[0]).toMatchObject({ number: 1, par: 4, si: 7, lengthM: 350 });
    expect(c.holes[0].green?.polygon?.length).toBe(3);
    const blank = catalogToCourse(cat.courses[1]);
    expect(blank.holes.length).toBe(18);
    expect(blank.location).toEqual({ lat: -27.43, lon: 153.07 });
  });
});


describe('pars when the map has none', () => {
  it('works par out from the hole length', () => {
    expect(parFromLength(150)).toBe(3);
    expect(parFromLength(229)).toBe(3);
    expect(parFromLength(340)).toBe(4);
    expect(parFromLength(431)).toBe(5);
    expect(parFromLength(undefined)).toBe(4);
  });

  it('a list with every hole a par 4 (no pars in the map) gets estimated pars, flagged', () => {
    const lens = [344, 157, 375, 515, 490, 147, 330, 360, 400, 380, 150, 470, 350, 320, 180, 500, 390, 410];
    const c = catalogToCourse({ ref: 'way/1', name: 'Test GC', at: [-26.8, 153.1], holes: lens.map((len, i) => ({ n: i + 1, par: 4, si: i + 1, len })) });
    expect(c.holes.map((h) => h.par)).toEqual(lens.map((l) => parFromLength(l)));
    expect(c.holes.every((h) => h.parEst && h.siEst)).toBe(true);
  });

  it('leaves real pars and stroke indexes alone', () => {
    const c = catalogToCourse({ ref: 'way/2', name: 'Real GC', at: [-26.6, 152.9], holes: [{ n: 1, par: 4, si: 7, len: 200 }, { n: 2, par: 3, si: 3, len: 150 }, { n: 3, par: 5, si: 1, len: 470 }] });
    expect(c.holes.map((h) => h.par)).toEqual([4, 3, 5]);
    expect(c.holes.some((h) => h.parEst)).toBe(false);
  });
});
