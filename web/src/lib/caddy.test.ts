import { describe, expect, it } from 'vitest';
import type { Hazard, Hole, Round, Settings } from '../types';
import { fromLocal, distanceM } from './geo';
import { advise, buildBag, expectedStrokes, roundMood, tendencies, type Conditions } from './caddy';

const O = { lat: -26.63, lon: 152.95 };
const P = (x: number, y: number) => fromLocal(O, x, y);
const rect = (x: number, y: number, w: number, h: number) => [P(x - w, y - h), P(x + w, y - h), P(x + w, y + h), P(x - w, y + h)];

const settings: Settings = {
  me: { id: 'me', name: 'Toddy', gaHandicap: 14 },
  units: 'm',
  clubs: ['Driver', '3W', 'Hybrid', '5i', '6i', '7i', '8i', '9i', 'PW', 'SW', 'Putter'],
};
const bag = buildBag(settings, [], 14);
const noTend = { lat: 0, long: 0, notes: [] };
const calm: Conditions = {};

// A green 150 m north of the golfer, 30 m deep and 24 m wide
const green = { centre: P(0, 150), polygon: rect(0, 150, 12, 15) };
const par3: Hole = { number: 3, par: 3, si: 15, tee: P(0, 0), green, lengthM: 150 };

const sideOf = (aim: { lat: number; lon: number }) => fromLocalX(aim);
function fromLocalX(p: { lat: number; lon: number }) {
  // metres east of the line of play
  return distanceM({ lat: p.lat, lon: O.lon }, p) * Math.sign(p.lon - O.lon);
}

describe('expected strokes', () => {
  it('gets harder further away and from worse lies', () => {
    expect(expectedStrokes('green', 1, 14)).toBeLessThan(expectedStrokes('green', 10, 14));
    expect(expectedStrokes('fairway', 100, 14)).toBeLessThan(expectedStrokes('rough', 100, 14));
    expect(expectedStrokes('rough', 30, 14)).toBeLessThan(expectedStrokes('water', 30, 14));
    expect(expectedStrokes('fairway', 150, 0)).toBeLessThan(expectedStrokes('fairway', 150, 20));
  });
});

describe('the caddy', () => {
  it('picks the right club for a plain par 3 and aims at the middle', () => {
    const a = advise({ hole: par3, from: P(0, 0), bag, cond: calm, tend: noTend, handicap: 14, mood: { caution: 0.12 }, units: 'm' })!;
    expect(Math.abs(a.best.carryReal - 150)).toBeLessThan(15);
    expect(Math.abs(sideOf(a.best.aim))).toBeLessThan(6);
  });

  it('steers away from water right of the green', () => {
    const water: Hazard[] = [{ kind: 'water', poly: rect(24, 150, 10, 30) }];
    const pin = P(8, 150); // pin tucked right, near the water
    const a = advise({ hole: par3, hazards: water, pin, from: P(0, 0), bag, cond: calm, tend: noTend, handicap: 14, mood: { caution: 0.12 }, units: 'm' })!;
    expect(sideOf(a.best.aim)).toBeLessThan(5); // aims left of the pin (pin is at +8)
    expect(a.aimText).toMatch(/left of the pin/);
    expect(a.lines.join(' ')).toMatch(/Water/);
    expect((a.best.trouble.water ?? 0)).toBeLessThan(0.15);
  });

  it('takes more club into the wind', () => {
    const calmA = advise({ hole: par3, from: P(0, 0), bag, cond: calm, tend: noTend, handicap: 14, mood: { caution: 0.12 }, units: 'm' })!;
    const into = advise({ hole: par3, from: P(0, 0), bag, cond: { windKmh: 30, windFromDeg: 0 }, tend: noTend, handicap: 14, mood: { caution: 0.12 }, units: 'm' })!;
    expect(into.best.club.total).toBeGreaterThan(calmA.best.club.total);
  });

  it('allows for a golfer who keeps coming up short', () => {
    const shortTend = { lat: 0, long: -0.5, notes: ['short'] };
    const normal = advise({ hole: par3, from: P(0, 0), bag, cond: calm, tend: noTend, handicap: 14, mood: { caution: 0.12 }, units: 'm' })!;
    const s = advise({ hole: par3, from: P(0, 0), bag, cond: calm, tend: shortTend, handicap: 14, mood: { caution: 0.12 }, units: 'm' })!;
    expect(s.best.club.total).toBeGreaterThanOrEqual(normal.best.club.total);
  });

  it('off the tee, keeps the driver away from water in the landing zone', () => {
    const green4 = { centre: P(0, 360), polygon: rect(0, 360, 12, 15) };
    const par4: Hole = { number: 1, par: 4, si: 5, tee: P(0, 0), green: green4, lengthM: 360 };
    // water on the right at 180-240 m
    const water: Hazard[] = [{ kind: 'water', poly: rect(25, 210, 15, 35) }];
    const a = advise({ hole: par4, hazards: water, from: P(0, 0), bag, cond: calm, tend: noTend, handicap: 14, mood: { caution: 0.12 }, units: 'm' })!;
    expect(a.mode).toBe('tee');
    expect((a.best.trouble.water ?? 0)).toBeLessThan(0.12);
    // either aimed left of the line, or a club that stays short of the water
    expect(sideOf(a.best.aim) < -4 || a.best.carryReal < 175).toBe(true);
  });

  it('lays up short of water in front of a par 5 green rather than going for it', () => {
    const green5 = { centre: P(0, 250), polygon: rect(0, 250, 12, 14) };
    const par5: Hole = { number: 9, par: 5, si: 3, tee: P(0, -230), green: green5, lengthM: 480 };
    const water: Hazard[] = [{ kind: 'water', poly: rect(0, 215, 30, 18) }];
    const a = advise({ hole: par5, hazards: water, from: P(0, 0), bag, cond: calm, tend: noTend, handicap: 18, mood: { caution: 0.12 }, units: 'm' })!;
    expect(a.best.carryReal).toBeLessThan(195); // stays short of the water
    expect((a.best.trouble.water ?? 0)).toBeLessThan(0.1);
  });

  it('reads tendencies and the state of the round', () => {
    const r = (stats: Round['stats']): Round => ({
      id: 'x', courseId: 'c', courseName: 'C', date: '2026-11-01', format: 'stableford', holes: [par3], players: [], meId: 'me',
      scores: {}, stats, shots: {}, pins: {}, options: { allowance: 100, skinsNet: false, skinsCarryOver: true }, completed: true, startedAt: 1,
    });
    const t = tendencies([r({ 1: { fairway: 'right' }, 2: { fairway: 'right' }, 3: { fairway: 'right' }, 4: { fairway: 'right' }, 5: { approachMiss: 'short' }, 6: { approachMiss: 'short' }, 7: { approachMiss: 'short' } })]);
    expect(t.lat).toBeGreaterThan(0.12);
    expect(t.long).toBeLessThan(-0.12);
    expect(t.notes.join(' ')).toMatch(/missing right/);

    const holes: Hole[] = [1, 2, 3].map((n) => ({ number: n, par: 4, si: n }));
    const live: Round = { ...r({}), holes, players: [{ id: 'me', name: 'T', gaHandicap: 0, dailyHandicap: 0, playingHandicap: 0 }], scores: { me: { 1: 4, 2: 7 } }, completed: false };
    expect(roundMood(live, 3).caution).toBeGreaterThan(0.3); // just made a triple
  });
});
