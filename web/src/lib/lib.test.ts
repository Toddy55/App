import { describe, expect, it, vi } from 'vitest';
import { distanceM, greenDistances, fromLocal, bearingDeg } from './geo';
import { ambroseTeamHandicap, dailyHandicap, strokesByHole, stablefordPoints } from './handicap';
import { computeResult } from './scoring';
import { coach } from './analysis';
import { blankHoles, buildCourse } from './courses';
import { playsLike, windEffect } from './weather';
import type { Round } from '../types';

const holes = blankHoles(18);

function round(partial: Partial<Round>): Round {
  return {
    id: 'r',
    courseId: 'c',
    courseName: 'Test GC',
    date: '2026-11-20',
    format: 'stableford',
    holes,
    players: [],
    meId: 'a',
    scores: {},
    stats: {},
    shots: {},
    pins: {},
    options: { allowance: 100, skinsNet: false, skinsCarryOver: true },
    completed: true,
    startedAt: 0,
    ...partial,
  };
}

describe('geo', () => {
  it('measures distance', () => {
    const a = { lat: -33.8688, lon: 151.2093 };
    const b = fromLocal(a, 0, 150);
    expect(distanceM(a, b)).toBeCloseTo(150, 0);
    expect(bearingDeg(a, b)).toBeCloseTo(0, 0);
  });
  it('finds front/centre/back of a green', () => {
    const p = { lat: -37.8, lon: 144.9 };
    const c = fromLocal(p, 0, 150);
    // 30 m deep, 20 m wide square green centred 150 m north
    const poly = [
      fromLocal(p, -10, 135),
      fromLocal(p, 10, 135),
      fromLocal(p, 10, 165),
      fromLocal(p, -10, 165),
    ];
    const d = greenDistances(p, { centre: c, polygon: poly });
    expect(d.front).toBeCloseTo(135, 0);
    expect(d.centre).toBeCloseTo(150, 0);
    expect(d.back).toBeCloseTo(165, 0);
  });
});

describe('handicap', () => {
  it('daily handicap (GA formula)', () => {
    // 18.0 GA, slope 130, scratch 73, par 72 => 18*130/113 + 1 = 21.7 -> 22
    expect(dailyHandicap(18, 72, 130, 73)).toBe(22);
    expect(dailyHandicap(10, 72)).toBe(10);
  });
  it('ambrose team handicaps', () => {
    expect(ambroseTeamHandicap([10, 20])).toBe(7.5); // 30/4
    expect(ambroseTeamHandicap([10, 20, 30, 40])).toBe(12.5); // 100/8
    expect(ambroseTeamHandicap([12, 18, 6])).toBe(6); // 36/6
  });
  it('allocates strokes by index', () => {
    const s = strokesByHole(20, holes);
    expect(s[1]).toBe(2); // SI 1
    expect(s[2]).toBe(2); // SI 2
    expect(s[3]).toBe(1);
    expect(Object.values(s).reduce((a, b) => a + b, 0)).toBe(20);
    const plus = strokesByHole(-2, holes);
    expect(plus[18]).toBe(-1);
    expect(plus[17]).toBe(-1);
    expect(plus[1]).toBe(0);
  });
  it('stableford points', () => {
    expect(stablefordPoints(5, 4, 1)).toBe(2);
    expect(stablefordPoints(3, 4, 0)).toBe(3);
    expect(stablefordPoints(8, 4, 0)).toBe(0);
  });
});

describe('scoring', () => {
  const players = [
    { id: 'a', name: 'Toddy', gaHandicap: 18, dailyHandicap: 18, playingHandicap: 18 },
    { id: 'b', name: 'Mate', gaHandicap: 0, dailyHandicap: 0, playingHandicap: 0 },
  ];
  const all = (n: number) => Object.fromEntries(holes.map((h) => [h.number, h.par + n]));
  it('stableford: bogey golf off 18 = 36 pts', () => {
    const r = computeResult(round({ players, scores: { a: all(1), b: all(0) } }));
    expect(r.rows.find((x) => x.id === 'a')!.points).toBe(36);
    expect(r.rows.find((x) => x.id === 'b')!.points).toBe(36);
  });
  it('match play halves when both play to handicap', () => {
    const r = computeResult(round({ format: 'matchplay', players, scores: { a: all(1), b: all(0) } }));
    expect(r.matchStatus).toBe('Match halved');
  });
  it('match play closes out early', () => {
    const r = computeResult(round({ format: 'matchplay', players, scores: { a: all(0), b: all(0) } }));
    expect(r.matchStatus).toBe('Toddy wins 10&8');
  });
  it('ambrose net uses team handicap off the total', () => {
    const r = computeResult(
      round({
        format: 'ambrose',
        teams: [{ id: 't1', name: 'Team 1', playerIds: ['a', 'b'], handicap: 4.5 }],
        meId: 't1',
        scores: { t1: all(0) },
      }),
    );
    expect(r.rows[0].gross).toBe(72);
    expect(r.rows[0].net).toBe(67.5);
  });
  it('skins carry over', () => {
    const a = all(0);
    const b = all(0);
    b[3] = 2; // birdie wins hole 3 worth 3 skins (1, 2 carried)
    const r = computeResult(round({ format: 'skins', players, scores: { a, b } }));
    expect(r.skinsByHole![3]).toEqual({ winner: 'Mate', value: 3 });
  });
});

describe('coaching', () => {
  it('flags three-putts on greens hit in regulation', () => {
    const scores = Object.fromEntries(holes.map((h) => [h.number, h.par + 1]));
    const stats: Round['stats'] = {};
    for (const h of holes) stats[h.number] = { putts: 2, fairway: h.par === 3 ? 'na' : 'hit' };
    stats[1] = { putts: 3, fairway: 'hit' };
    stats[9] = { putts: 3, fairway: 'hit' };
    stats[5] = { putts: 3, fairway: 'hit' };
    stats[12] = { putts: 3, fairway: 'na' };
    stats[14] = { putts: 3, fairway: 'hit' };
    const c = coach(round({ scores: { a: scores }, stats }), 10);
    expect(c.focus[0].id).toBe('putting');
    expect(c.focus[0].detail).toContain('hitting the green in regulation');
    expect(c.costliest.length).toBe(5);
  });
});

describe('courses', () => {
  it('builds holes from OSM data', () => {
    const tee = { lat: -35, lon: 149 };
    const end = fromLocal(tee, 0, 350);
    const green = [fromLocal(tee, -10, 340), fromLocal(tee, 10, 340), fromLocal(tee, 10, 365), fromLocal(tee, -10, 365)];
    const c = buildCourse({ osmRef: 'way/1', name: 'Test' }, [
      { type: 'way', id: 2, tags: { golf: 'hole', ref: '1', par: '4', handicap: '7' }, geometry: [tee, end] },
      { type: 'way', id: 3, tags: { golf: 'green' }, geometry: [...green, green[0]] },
    ]);
    expect(c.holes[0]).toMatchObject({ number: 1, par: 4, si: 7, lengthM: 350 });
    expect(c.holes[0].green?.polygon).toBeTruthy();
  });
});

describe('weather', () => {
  it('headwind adds distance, tailwind takes it off', () => {
    const into = windEffect(0, 20, 0); // wind from north, hitting north
    expect(into.head).toBeCloseTo(20);
    expect(playsLike(150, into).distance).toBeCloseTo(168, 0);
    const help = windEffect(180, 20, 0);
    expect(playsLike(150, help).distance).toBeCloseTo(141, 0);
    const fromRight = windEffect(90, 20, 0); // hitting north, wind from east -> pushes ball left
    expect(fromRight.cross).toBeLessThan(0);
    expect(playsLike(150, fromRight).aimOffM).toBeGreaterThan(0); // aim right
  });
});

describe('course search', () => {
  it('finds courses by name and around a town, with no duplicates', async () => {
    const { searchCourses } = await import('./courses');
    const real = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('nominatim') && url.includes('golf')) {
        return new Response(JSON.stringify([
          { osm_type: 'way', osm_id: 10, lat: '-26.63', lon: '152.95', name: 'Nambour Golf Club', category: 'leisure', type: 'golf_course', display_name: 'Nambour Golf Club, Nambour', address: { town: 'Nambour', state: 'Queensland' } },
        ]));
      }
      if (url.includes('nominatim')) {
        return new Response(JSON.stringify([{ osm_type: 'relation', osm_id: 5, lat: '-26.63', lon: '152.96', name: 'Nambour', category: 'place', type: 'town', display_name: 'Nambour, QLD' }]));
      }
      expect(decodeURIComponent(String(init?.body))).toContain('around:20000');
      return new Response(JSON.stringify({ elements: [
        { type: 'way', id: 10, center: { lat: -26.63, lon: 152.95 }, tags: { name: 'Nambour Golf Club' } },
        { type: 'way', id: 11, center: { lat: -26.7, lon: 152.98 }, tags: { name: 'Palmwoods Golf Course' } },
      ] }));
    }) as typeof fetch;
    try {
      const hits = await searchCourses('Nambour');
      expect(hits.map((h) => h.name)).toEqual(['Nambour Golf Club', 'Palmwoods Golf Course']);
      expect(hits[0].state).toBe('Queensland');
    } finally {
      globalThis.fetch = real;
    }
  });
  it('gives up on a server that never answers and tries the next', async () => {
    const { nearbyCourses } = await import('./courses');
    const real = globalThis.fetch;
    let n = 0;
    globalThis.fetch = ((_u: RequestInfo | URL, init?: RequestInit) => {
      n++;
      if (n === 1) return new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
      return Promise.resolve(new Response(JSON.stringify({ elements: [{ type: 'way', id: 1, center: { lat: 0, lon: 0 }, tags: { name: 'Backup GC' } }] })));
    }) as typeof fetch;
    vi.useFakeTimers();
    try {
      const p = nearbyCourses({ lat: 0, lon: 0 });
      await vi.advanceTimersByTimeAsync(16000);
      expect((await p).map((h) => h.name)).toEqual(['Backup GC']);
    } finally {
      vi.useRealTimers();
      globalThis.fetch = real;
    }
  });
});
