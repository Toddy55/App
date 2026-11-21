import { describe, expect, it } from 'vitest';
import { fromLocal, toLocal } from './geo';
import { toMerc, type Dem } from './greenDem';
import { approachNote, cellCentre, contours, greenCells, greenSummary, readPutt, slopeAt, smooth } from './greenRead';

const O = { lat: -26.63, lon: 152.95 };
const P = (x: number, y: number) => fromLocal(O, x, y);

/** A 40 m square of ground whose height is f(east, north). */
function makeDem(f: (x: number, y: number) => number, n = 40): Dem {
  const a = toMerc(P(-20, -20));
  const b = toMerc(P(20, 20));
  const dem: Dem = { w: n, h: n, z: new Float32Array(n * n), xmin: a.x, xmax: b.x, ymin: a.y, ymax: b.y, cellM: 40 / n };
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const q = toLocal(O, cellCentre(dem, i, j));
      dem.z[j * n + i] = f(q.x, q.y);
    }
  return dem;
}

describe('reading a green', () => {
  // Rises 2% to the north, so it falls to the south
  const tilt = makeDem((_x, y) => 10 + 0.02 * y);

  it('finds the slope and which way it falls', () => {
    const s = slopeAt(tilt, O)!;
    expect(s.pct).toBeCloseTo(2, 1);
    expect(Math.abs(s.downhillDeg - 180)).toBeLessThan(2);
  });

  it('reads an uphill putt as straight and uphill', () => {
    const r = readPutt(tilt, P(0, -5), P(0, 5))!;
    expect(r.riseCm).toBeCloseTo(20, 0);
    expect(Math.abs(r.breakCm)).toBeLessThan(2);
    expect(r.text).toMatch(/20 cm uphill/);
    expect(r.text).toMatch(/straight/);
  });

  it('reads a sidehill putt: walking west, high side on the right, so it breaks left', () => {
    const r = readPutt(tilt, P(3, 0), P(-3, 0))!;
    expect(r.sidePct).toBeCloseTo(2, 1);
    expect(r.breakCm).toBeGreaterThan(20);
    expect(r.text).toMatch(/breaks right to left/);
    expect(r.text).toMatch(/right of the hole/);
    const back = readPutt(tilt, P(-3, 0), P(3, 0))!;
    expect(back.breakCm).toBeLessThan(-20);
    expect(back.text).toMatch(/left to right/);
  });

  it('tells you where to miss the approach', () => {
    // Coming in from the south: the green falls towards you
    expect(approachNote(tilt, O, P(0, -150))).toMatch(/falls back to front/);
    // Coming from the north: it falls away
    expect(approachNote(tilt, O, P(0, 150))).toMatch(/falls away/);
    // Coming from the west: falls left to right? Facing east, south is on the right, so it falls to the right
    expect(approachNote(tilt, O, P(-150, 0))).toMatch(/left to right.*miss on the right/);
    const flat = makeDem(() => 5);
    expect(approachNote(flat, O, P(0, -150))).toMatch(/flat/);
  });

  it('builds the slope map, summary and contour lines', () => {
    const bowl = smooth(makeDem((x, y) => 0.0015 * (x * x + y * y)));
    const poly = [P(-12, -12), P(12, -12), P(12, 12), P(-12, 12)];
    const cells = greenCells(bowl, poly, O);
    expect(cells.length).toBeGreaterThan(400);
    const sum = greenSummary(cells)!;
    expect(sum.tilt.pct).toBeLessThan(0.5); // a bowl has no overall tilt
    expect(sum.max).toBeGreaterThan(2.5);
    const lines = contours(bowl);
    expect(lines.length).toBeGreaterThan(3);
    expect(lines.length).toBeLessThanOrEqual(15);
  });
});
