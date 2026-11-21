import { describe, expect, it } from 'vitest';
import { cameraPitchFromOrientation, fitShot, makeCamera, project, sampleAt, simulate, type Camera, type ShotParams } from './ballflight';

// A phone 3 m behind the ball, 1 m up, tilted up 4°, portrait 1080×1920 scaled to the 320-wide tracking frame
function trueCamera(height = 1.0, back = 3, side = 0.3, fov = 68, pitchDeg = 4): Camera {
  const w = 320, h = 569;
  const F = Math.max(w, h) / 2 / Math.tan((fov * Math.PI) / 360);
  return { w, h, F, pitch: (pitchDeg * Math.PI) / 180, cx: -side, cd: -back, cz: height };
}

function observe(cam: Camera, p: ShotParams, visibleFor: number, noise = 0.6) {
  const path = simulate(p);
  const obs = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * noise;
  for (let t = 0.05; t < Math.min(visibleFor, path[path.length - 1].t); t += 1 / 30) {
    const q = project(cam, sampleAt(path, t));
    obs.push({ t, x: q.x + rnd(), y: q.y + rnd() });
  }
  return { path, obs, ball: project(cam, { x: 0, d: 0, z: 0 }) };
}

const SHOTS: Record<string, ShotParams> = {
  'wedge, straight': { v0: 38, launch: 26, lift: 0.22, dir: 0, curve: 0 },
  '7-iron, fade': { v0: 48, launch: 18, lift: 0.21, dir: -2, curve: 1.2 },
  'driver, draw': { v0: 66, launch: 12, lift: 0.17, dir: 3, curve: -1.0 },
};
const CLUB: Record<string, string> = { 'wedge, straight': 'PW', '7-iron, fade': '7i', 'driver, draw': 'Driver' };
// Typical club-golfer shots (what the club defaults are built around)
const CLUB_GOLFER: Record<string, [ShotParams, string]> = {
  '7-iron': [{ v0: 42, launch: 19, lift: 0.2, dir: 1, curve: 0.5 }, '7i'],
  driver: [{ v0: 58, launch: 14, lift: 0.18, dir: -3, curve: 2 }, 'Driver'],
  'pitching wedge': [{ v0: 34, launch: 25, lift: 0.22, dir: 0, curve: -0.4 }, 'PW'],
};

describe('ball flight physics', () => {
  it('gives realistic carries', () => {
    const carry = (p: ShotParams) => simulate(p).at(-1)!.d;
    expect(carry(SHOTS['wedge, straight'])).toBeGreaterThan(95);
    expect(carry(SHOTS['wedge, straight'])).toBeLessThan(130);
    expect(carry(SHOTS['driver, draw'])).toBeGreaterThan(190);
    expect(carry(SHOTS['driver, draw'])).toBeLessThan(240);
  });
  it('reads camera tilt from the phone', () => {
    expect(cameraPitchFromOrientation(90, 0)).toBeCloseTo(0); // upright portrait
    expect(cameraPitchFromOrientation(100, 0)).toBeCloseTo(10, 0); // leaning back, looking up
    expect(cameraPitchFromOrientation(0, 90)).toBeCloseTo(0); // upright landscape
  });
  it('places the camera from where the ball sits in the picture', () => {
    const cam = trueCamera();
    const ball = project(cam, { x: 0, d: 0, z: 0 });
    const est = makeCamera(cam.w, cam.h, 4, ball, 68, 1.0);
    expect(est.cd).toBeCloseTo(-3, 1);
    expect(est.cx).toBeCloseTo(-0.3, 1);
  });
});

describe('fitting the shot from what the camera saw', () => {
  for (const [name, p] of Object.entries(SHOTS)) {
    it(`${name} (strong hitter): carry within 12% before calibration, landing side and hang time`, () => {
      const cam = trueCamera();
      const { path, obs, ball } = observe(cam, p, 1.5);
      const est = makeCamera(cam.w, cam.h, 4, ball);
      const r = fitShot(est, obs, undefined, 1, CLUB[name])!;
      const land = path.at(-1)!;
      expect(Math.abs(r.carry - land.d) / land.d).toBeLessThan(0.12);
      expect(Math.abs(r.lateral - land.x)).toBeLessThan(6);
      expect(Math.abs(r.hang - land.t)).toBeLessThan(0.7);
    });
  }

  for (const [name, [p, club]] of Object.entries(CLUB_GOLFER)) {
    it(`club golfer's ${name}: carry within 6%, landing within 4 m, from under a second of flight`, () => {
      const cam = trueCamera();
      const { path, obs, ball } = observe(cam, p, 0.9);
      const r = fitShot(makeCamera(cam.w, cam.h, 4, ball), obs, undefined, 1, club)!;
      const land = path.at(-1)!;
      expect(Math.abs(r.carry - land.d) / land.d).toBeLessThan(0.06);
      expect(Math.abs(r.lateral - land.x)).toBeLessThan(4);
    });
  }

  it('stays in the ballpark when the phone is higher and the lens wider than assumed', () => {
    const p = SHOTS['7-iron, fade'];
    const cam = trueCamera(1.25, 3.5, 0, 72, 6); // reality differs from our defaults
    const { path, obs, ball } = observe(cam, p, 1.5);
    const r = fitShot(makeCamera(cam.w, cam.h, 6, ball), obs, undefined, 1, '7i')!; // we assume 1.0 m and 68°
    const carry = path.at(-1)!.d;
    expect(Math.abs(r.carry - carry) / carry).toBeLessThan(0.25);
  });

  it('calibration scales the numbers', () => {
    const cam = trueCamera();
    const { obs, ball } = observe(cam, SHOTS['wedge, straight'], 1.5);
    const est = makeCamera(cam.w, cam.h, 4, ball);
    const a = fitShot(est, obs)!;
    const b = fitShot(est, obs, undefined, 1.1)!;
    expect(b.carry / a.carry).toBeCloseTo(1.1, 2);
  });
});

describe('calibrating to your swing', () => {
  it("one 7-iron of known carry fixes the strong hitter's driver too", async () => {
    const { solveSpeedFactor } = await import('./ballflight');
    const cam = trueCamera();
    const seen = (p: ShotParams) => {
      const { path, obs, ball } = observe(cam, p, 0.9);
      return { carry: path.at(-1)!.d, obs, est: makeCamera(cam.w, cam.h, 4, ball) };
    };
    const iron = seen(SHOTS['7-iron, fade']);
    const before = fitShot(iron.est, iron.obs, undefined, 1, '7i')!.carry;
    const factor = solveSpeedFactor(iron.est, iron.obs, '7i', iron.carry);
    expect(factor).toBeGreaterThan(1.05); // this golfer hits it harder than typical
    const driver = seen(SHOTS['driver, draw']);
    const uncal = fitShot(driver.est, driver.obs, undefined, 1, 'Driver')!.carry;
    const cal = fitShot(driver.est, driver.obs, undefined, 1, 'Driver', factor)!.carry;
    expect(Math.abs(cal - driver.carry)).toBeLessThan(Math.abs(uncal - driver.carry));
    expect(Math.abs(cal - driver.carry) / driver.carry).toBeLessThan(0.07);
    expect(Math.abs(before - iron.carry)).toBeGreaterThan(5);
  }, 60000);
});

describe('robustness', () => {
  it('ignores a wrong speck the tracker grabbed mid-flight', () => {
    const cam = trueCamera();
    const [p, club] = CLUB_GOLFER['7-iron'];
    const { path, obs, ball } = observe(cam, p, 0.9);
    const bad = obs.map((o, i) => (i === 8 ? { ...o, x: o.x - 25, y: o.y + 30 } : o));
    const r = fitShot(makeCamera(cam.w, cam.h, 4, ball), bad, undefined, 1, club)!;
    const land = path.at(-1)!;
    expect(Math.abs(r.carry - land.d) / land.d).toBeLessThan(0.08);
    expect(Math.abs(r.lateral - land.x)).toBeLessThan(5);
  });
  it('gives the same answer whatever frame the strike was heard on', () => {
    const cam = trueCamera();
    const [p, club] = CLUB_GOLFER.driver;
    const { obs, ball } = observe(cam, p, 0.9);
    const est = makeCamera(cam.w, cam.h, 4, ball);
    const carries = [-1, 0, 1, 2].map((k) => fitShot(est, obs.map((o) => ({ ...o, t: o.t + k / 30 })), undefined, 1, club)!.carry);
    expect(Math.max(...carries) - Math.min(...carries)).toBeLessThan(4);
  });
});
