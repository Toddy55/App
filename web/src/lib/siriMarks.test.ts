import { describe, expect, it } from 'vitest';
import type { Hole, Round } from '../types';
import { applySiriMarks, holeForSpot, pushIdTime } from './siriMarks';

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const O = { lat: -26.63, lon: 152.95 };
const L = (x: number, y: number) => ({ lat: O.lat + deg(y / R), lon: O.lon + deg(x / (R * Math.cos(rad(O.lat)))) });
// Parallel holes 60 m apart, playing north
const holes: Hole[] = Array.from({ length: 4 }, (_, i) => ({ number: i + 1, par: 4, si: i + 1, tee: L(i * 60, 0), green: { centre: L(i * 60, 350) } }) as Hole);

describe('pushIdTime', () => {
  it('reads the time out of a Firebase push id', () => {
    // -NjW0... made at 1700000000000 ms
    const chars = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
    let t = 1700000000000;
    let id = '';
    for (let i = 0; i < 8; i++) {
      id = chars[t % 64] + id;
      t = Math.floor(t / 64);
    }
    expect(pushIdTime(id + 'abcdefghijkl')).toBe(1700000000000);
  });
});

describe('holeForSpot', () => {
  it("keeps a wayward shot on the hole you're playing", () => {
    // 40 m right of hole 2's line, i.e. nearer hole 3
    expect(holeForSpot(holes, L(60 + 40, 200), 2)).toBe(2);
  });
  it("moves on to the next hole's tee once you've played this one", () => {
    expect(holeForSpot(holes, L(120, 10), 2, true)).toBe(3);
  });
  it('starts a hole from its tee', () => {
    expect(holeForSpot(holes, L(60, 5), 2, false)).toBe(2);
  });
  it('ignores spots nowhere near the course', () => {
    expect(holeForSpot(holes, { lat: 0, lon: 0 }, 1)).toBeNull();
  });
});

describe('applySiriMarks', () => {
  const round = { id: 'r', startedAt: 1_000_000, completed: false, holes, shots: {} } as unknown as Round;
  it('drops new marks into the right holes once', () => {
    const marks = [
      { id: 'a', ...L(0, 5), t: 1_002_000 },
      { id: 'b', ...L(0, 200), t: 1_003_000 },
      { id: 'c', ...L(60, 5), t: 1_004_000 },
      { id: 'old', ...L(0, 5), t: 10 },
    ];
    const { round: r, added } = applySiriMarks(round, marks, holes);
    expect(added.map((a) => a.hole)).toEqual([1, 1, 2]);
    expect(r.shots[1]).toHaveLength(2);
    expect(r.shots[1][0].voice).toBe(true);
    expect(applySiriMarks(r, marks, holes).added).toHaveLength(0);
  });
});
