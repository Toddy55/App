import { describe, expect, it } from 'vitest';
import { BallTracker, diffBlobs, fitQuad, StrikeDetector } from './balltrack';

const W = 320, H = 480, FPS = 30;
const LAUNCH = { x: 120, y: 400 };
const T0 = 1.0; // impact
// True flight: up and slightly right, apex about 2.4 s after impact
const truth = (u: number) => ({ x: LAUNCH.x + 40 * u + 3 * u * u, y: LAUNCH.y - 230 * u + 48 * u * u });

/** Draw one frame: sky/ground, a "golfer" swinging next to the ball, and the ball. */
function frame(t: number, ballVisibleUntil = 3.2): Uint8Array {
  const g = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = y < 300 ? 170 : 90;
  // golfer: a tall block left of the ball, plus a club that swings through the ball spot
  const rect = (x0: number, y0: number, w: number, h: number, v: number) => {
    for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++) for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) g[y * W + x] = v;
  };
  rect(70, 230, 34, 170, 40);
  const swing = Math.sin(t * 2.2) * 40; // backswing and follow-through
  rect(Math.round(100 + swing), Math.round(330 - Math.abs(swing)), 30, 30, 20);
  // ball
  const u = t - T0;
  const p = u <= 0 ? LAUNCH : truth(u);
  if (u <= 0 || u < ballVisibleUntil) rect(Math.round(p.x - 2), Math.round(p.y - 2), 4, 4, 255);
  return g;
}

function run(tracker: BallTracker, seconds = 5, ballVisibleUntil = 3.2) {
  let prev = frame(0, ballVisibleUntil);
  for (let i = 1; i < seconds * FPS; i++) {
    const t = i / FPS;
    const cur = frame(t, ballVisibleUntil);
    tracker.feed(diffBlobs(prev, cur, W, H, 30, tracker.maxArea * 4), t);
    prev = cur;
    if (tracker.state === 'done') break;
  }
}

describe('ball tracker', () => {
  it('fits a quadratic exactly', () => {
    const ts = [0, 0.1, 0.2, 0.5, 1];
    const [a, b, c] = fitQuad(ts, ts.map((t) => 3 - 2 * t + 5 * t * t));
    expect(a).toBeCloseTo(3);
    expect(b).toBeCloseTo(-2);
    expect(c).toBeCloseTo(5);
  });

  it('spots the launch, follows the ball and finds the arc', () => {
    const tr = new BallTracker(LAUNCH, W, H);
    run(tr);
    const f = tr.flight()!;
    expect(f).toBeTruthy();
    expect(Math.abs(f.t0 - T0)).toBeLessThan(0.08);
    expect(tr.pts.length).toBeGreaterThan(30);
    // apex where the real ball's apex is (u = 230/96 ≈ 2.4 s)
    expect(Math.abs(f.tApex - T0 - 2.4)).toBeLessThan(0.2);
    for (const u of [0.5, 1.5, 2.5]) {
      const est = f.at(T0 + u);
      const real = truth(u);
      expect(Math.hypot(est.x - real.x, est.y - real.y)).toBeLessThan(6);
    }
  });

  it('finishes the flight from the arc when the ball gets too small to see', () => {
    const tr = new BallTracker(LAUNCH, W, H);
    run(tr, 6, 1.2); // ball disappears 1.2 s after impact, before its apex
    const f = tr.flight()!;
    expect(tr.state).toBe('done');
    expect(f.tEnd).toBeGreaterThan(T0 + 2); // extended past what was seen
    const real = truth(2);
    const est = f.at(T0 + 2);
    expect(Math.hypot(est.x - real.x, est.y - real.y)).toBeLessThan(40);
  });

  it("doesn't mistake the swing for a launch when waiting for the strike sound", () => {
    const tr = new BallTracker(LAUNCH, W, H, true);
    let prev = frame(0);
    for (let i = 1; i < 0.95 * FPS; i++) {
      const cur = frame(i / FPS);
      tr.feed(diffBlobs(prev, cur, W, H, 30), i / FPS);
      prev = cur;
    }
    expect(tr.state).toBe('armed');
    tr.strike(0.98);
    for (let i = Math.round(0.95 * FPS); i < 4 * FPS; i++) {
      const cur = frame(i / FPS);
      tr.feed(diffBlobs(prev, cur, W, H, 30), i / FPS);
      prev = cur;
    }
    expect(tr.flight()).toBeTruthy();
    expect(Math.abs(tr.flight()!.t0 - T0)).toBeLessThan(0.08);
  });

  it('hears a sharp strike but not steady wind noise', () => {
    const d = new StrikeDetector();
    let hits = 0;
    for (let i = 0; i < 200; i++) if (d.feed(0.05 + Math.random() * 0.03, i / 60)) hits++;
    expect(hits).toBe(0);
    expect(d.feed(0.8, 200 / 60)).toBe(true);
  });
});

describe('auto mode: no tap', () => {
  it('finds the ball sitting at address', async () => {
    const { findBallAtAddress } = await import('./balltrack');
    const p = findBallAtAddress(frame(0.3), W, H)!;
    expect(Math.hypot(p.x - LAUNCH.x, p.y - LAUNCH.y)).toBeLessThan(3);
  });

  for (const withHint of [false, true]) {
    it(`finds the launch from the strike alone${withHint ? ' (with the address spot)' : ''}`, async () => {
      const { findBallAtAddress } = await import('./balltrack');
      const tr = new BallTracker(null, W, H, true);
      if (withHint) tr.hint = findBallAtAddress(frame(0.3), W, H);
      let prev = frame(0);
      for (let i = 1; i < 5 * FPS; i++) {
        const t = i / FPS;
        if (Math.abs(t - 0.98) < 0.5 / FPS) tr.strike(t);
        const cur = frame(t);
        tr.feed(diffBlobs(prev, cur, W, H, 30, tr.maxArea * 4), t);
        prev = cur;
        if (tr.state === 'done') break;
      }
      const f = tr.flight()!;
      expect(f).toBeTruthy();
      expect(Math.abs(f.t0 - T0)).toBeLessThan(0.1);
      expect(Math.hypot(tr.launch!.x - LAUNCH.x, tr.launch!.y - LAUNCH.y)).toBeLessThan(withHint ? 3 : 15);
      const real = truth(1.5);
      const est = f.at(T0 + 1.5);
      expect(Math.hypot(est.x - real.x, est.y - real.y)).toBeLessThan(8);
    });
  }
});
