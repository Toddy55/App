import { describe, expect, it } from 'vitest';
import { bearingDeg, distanceM, fromLocal } from './geo';
import { makeFrame, project, tileLayout, unproject } from './holeFrame';

const O = { lat: -26.63, lon: 152.95 };
const pad = { top: 50, right: 80, bottom: 60, left: 16 };

describe('hole frame', () => {
  // A hole running due east: tee at O, green 380 m east
  const green = fromLocal(O, 380, 0);
  const f = makeFrame({ origin: O, upDeg: bearingDeg(O, green), fit: [O, green], width: 400, height: 640, pad });

  it('puts the tee at the bottom and the green at the top, on the same vertical line', () => {
    const t = project(f, O);
    const g = project(f, green);
    expect(t.y).toBeGreaterThan(g.y + 400);
    expect(Math.abs(t.x - g.x)).toBeLessThan(0.5);
    expect(t.y).toBeLessThanOrEqual(640 - pad.bottom + 0.5);
    expect(g.y).toBeGreaterThanOrEqual(pad.top - 0.5);
  });

  it('keeps left as left: north is left when you face east', () => {
    const north = fromLocal(O, 100, 40);
    expect(project(f, north).x).toBeLessThan(project(f, fromLocal(O, 100, 0)).x);
  });

  it('turns a tap back into the same spot on the ground', () => {
    const p = fromLocal(O, 210, -17);
    const s = project(f, p);
    expect(distanceM(unproject(f, s.x, s.y), p)).toBeLessThan(0.01);
  });

  it('lines the satellite photo up with the overlay', () => {
    const lay = tileLayout(f, 400, 640, 2);
    expect(lay.tiles.length).toBeGreaterThan(0);
    expect(lay.tiles.length).toBeLessThan(120);
    // The matrix maps tile pixels to screen: the origin's tile pixel (0,0) lands on the tee
    const m = lay.matrix.match(/matrix\((.+)\)/)![1].split(' ').map(Number);
    const t = project(f, O);
    expect(Math.abs(m[4] - t.x)).toBeLessThan(0.5);
    expect(Math.abs(m[5] - t.y)).toBeLessThan(0.5);
    // ...and a point 300 m away lands where the overlay draws it (within a pixel)
    const p = fromLocal(O, 300, 60);
    const n = 256 * 2 ** lay.z;
    const merc = (q: { lat: number; lon: number }) => {
      const s = Math.sin((q.lat * Math.PI) / 180);
      return { x: ((q.lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
    };
    const dx = merc(p).x - merc(O).x;
    const dy = merc(p).y - merc(O).y;
    const sx = m[0] * dx + m[2] * dy + m[4];
    const sy = m[1] * dx + m[3] * dy + m[5];
    const want = project(f, p);
    expect(Math.hypot(sx - want.x, sy - want.y)).toBeLessThan(1);
  });
});
