import { describe, expect, it } from 'vitest';
import type { Hazard, Hole, Settings } from '../types';
import { fromLocal } from './geo';
import { advise, buildBag } from './caddy';
import { ballHeight, treePlay } from './trees';

const O = { lat: -26.63, lon: 152.95 };
const P = (x: number, y: number) => fromLocal(O, x, y);
const box = (x0: number, y0: number, x1: number, y1: number) => [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
const settings: Settings = { me: { id: 'me', name: 'T', gaHandicap: 14 }, units: 'm', clubs: ['Driver', '3W', '5i', '7i', '8i', '9i', 'PW', 'SW'] };
const bag = buildBag(settings, [], 14);
const base = { bag, cond: {}, tend: { lat: 0, long: 0, notes: [] }, handicap: 14, mood: { caution: 0.12 }, units: 'm' as const };
// Par 4 playing north, green 360 m up, fairway 30 m wide down the middle
const fairway: Hazard = { kind: 'fairway', poly: box(-15, 20, 15, 345) };
const hole: Hole = { number: 1, par: 4, si: 1, tee: P(0, 0), green: { centre: P(0, 360), polygon: box(-12, 348, 12, 372) } };

describe('ball flight over trees', () => {
  it('is low at the start and end, high in the middle', () => {
    expect(ballHeight(200, 0.05)).toBeLessThan(8);
    expect(ballHeight(200, 0.5)).toBeGreaterThan(25);
  });
  it("ignores trees the ball flies straight over", () => {
    // A clump right on the line, 100 m out on a 200 m shot: the ball is 28 m up
    expect(treePlay(P(0, 0), P(0, 200), [box(-6, 95, 6, 105)]).kind).toBe('clear');
  });
});

describe('the caddie and trees', () => {
  it('says draw or fade when trees block the line but there is a way round', () => {
    // You're in the right rough 150 m out; a stand of trees 20–40 m ahead, just across the line
    const from = P(25, 210);
    const trees: Hazard = { kind: 'trees', poly: box(18, 225, 30, 262) };
    const a = advise({ ...base, hole, hazards: [fairway, trees], from })!;
    expect(a.trees?.kind).toBe('shape');
    expect(a.headline).toMatch(/draw|fade/);
    expect(a.lines[0]).toMatch(/🌳 Trees in the way/);
  });
  it('says take your medicine when there is no way through', () => {
    // Deep in a wood right of the fairway: trees everywhere between you and the green
    const from = P(32, 200);
    const wood: Hazard = { kind: 'trees', poly: box(18, 150, 90, 330) };
    const a = advise({ ...base, hole, hazards: [fairway, wood], from })!;
    expect(a.headline).toBe('Chip out');
    expect(a.trees?.kind).toBe('chip');
    expect(a.aimText).toMatch(/Chip it out \d+ m back to the fairway/);
    expect(a.lines[0]).toMatch(/Take your medicine/);
  });
  it('says nothing about trees on a clear line', () => {
    const a = advise({ ...base, hole, hazards: [fairway, { kind: 'trees', poly: box(30, 50, 60, 300) }], from: P(0, 0) })!;
    expect(a.trees).toBeUndefined();
    expect(a.lines.join(' ')).not.toMatch(/🌳/);
  });
});

import { buildHazards } from './courses';
describe('trees from the course map', () => {
  it('reads woods, tree rows and single trees', () => {
    const g = (pts: [number, number][]) => pts.map(([x, y]) => { const p = P(x, y); return { lat: p.lat, lon: p.lon }; });
    const hz = buildHazards([
      { type: 'way', id: 1, tags: { natural: 'wood' }, geometry: g([[0, 0], [30, 0], [30, 30], [0, 30], [0, 0]]) },
      { type: 'way', id: 2, tags: { natural: 'tree_row' }, geometry: g([[0, 50], [0, 120]]) },
      { type: 'node', id: 3, tags: { natural: 'tree' }, lat: P(50, 50).lat, lon: P(50, 50).lon },
    ]);
    expect(hz.map((z) => z.kind)).toEqual(['trees', 'trees', 'trees']);
    expect(hz[1].poly.length).toBeGreaterThanOrEqual(4);
    expect(hz[2].poly).toHaveLength(8);
  });
});
