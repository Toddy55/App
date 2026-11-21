import type { Pt } from './tracer';

/**
 * Live ball tracking for the shot tracer.
 *
 * Works on small greyscale frames. With the phone held still, the difference
 * between consecutive frames is mostly the moving ball (and the golfer). After
 * the strike (heard on the microphone, or seen), we look for a small blob
 * leaving the ball's spot, follow it frame by frame with a ballistic
 * prediction, and when it gets too small to see we extend the fitted arc to
 * an estimated landing point.
 */

export interface Blob {
  x: number;
  y: number;
  area: number;
  w: number;
  h: number;
}

export function toGray(rgba: Uint8ClampedArray, out: Uint8Array) {
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
}

/** Connected groups of pixels that changed between two frames. */
export function diffBlobs(prev: Uint8Array, cur: Uint8Array, w: number, h: number, thresh = 30, maxArea = Infinity): Blob[] {
  const n = w * h;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (Math.abs(cur[i] - prev[i]) > thresh) mask[i] = 1;
  const blobs: Blob[] = [];
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    if (mask[i] !== 1) continue;
    let area = 0,
      sx = 0,
      sy = 0,
      minX = w,
      maxX = 0,
      minY = h,
      maxY = 0;
    mask[i] = 2;
    stack.push(i);
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % w;
      const y = (k - x) / w;
      area++;
      sx += x;
      sy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && mask[k - 1] === 1) (mask[k - 1] = 2), stack.push(k - 1);
      if (x < w - 1 && mask[k + 1] === 1) (mask[k + 1] = 2), stack.push(k + 1);
      if (y > 0 && mask[k - w] === 1) (mask[k - w] = 2), stack.push(k - w);
      if (y < h - 1 && mask[k + w] === 1) (mask[k + w] = 2), stack.push(k + w);
    }
    if (area <= maxArea) blobs.push({ x: sx / area, y: sy / area, area, w: maxX - minX + 1, h: maxY - minY + 1 });
  }
  return blobs;
}

/** Least-squares fit v = a + b·t + c·t². */
export function fitQuad(ts: number[], vs: number[]): [number, number, number] {
  const n = ts.length;
  if (n === 0) return [0, 0, 0];
  if (n === 1) return [vs[0], 0, 0];
  if (n === 2) {
    const b = (vs[1] - vs[0]) / (ts[1] - ts[0] || 1e-6);
    return [vs[0] - b * ts[0], b, 0];
  }
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, y0 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < n; i++) {
    const t = ts[i], t2 = t * t;
    s0 += 1; s1 += t; s2 += t2; s3 += t2 * t; s4 += t2 * t2;
    y0 += vs[i]; y1 += vs[i] * t; y2 += vs[i] * t2;
  }
  // Solve the 3x3 normal equations (Cramer's rule)
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const M = [[s0, s1, s2], [s1, s2, s3], [s2, s3, s4]];
  const D = det(M);
  if (Math.abs(D) < 1e-9) return fitQuad(ts.slice(-2), vs.slice(-2));
  const col = (j: number) => M.map((row, i) => row.map((v, k) => (k === j ? [y0, y1, y2][i] : v)));
  return [det(col(0)) / D, det(col(1)) / D, det(col(2)) / D];
}

export interface TrackPoint {
  t: number;
  x: number;
  y: number;
}

export interface Flight {
  /** Seconds, same clock as the frames. */
  t0: number;
  tApex: number;
  tEnd: number;
  at: (t: number) => Pt;
  tracked: TrackPoint[];
}

export type TrackState = 'armed' | 'tracking' | 'done';

export class BallTracker {
  state: TrackState = 'armed';
  pts: TrackPoint[] = [];
  private pending: TrackPoint | null = null;
  private misses = 0;
  private strikeAt: number | null = null;
  readonly s: number;
  readonly maxArea: number;
  /** Where the ball sat. Null in auto mode: found from the flight after the strike. */
  launch: Pt | null;
  /** Hint from spotting the ball at address (auto mode). */
  hint: Pt | null = null;
  readonly w: number;
  readonly h: number;
  /** When true the tracker waits for strike() (microphone) before looking for the ball. */
  readonly needsStrike: boolean;

  constructor(launch: Pt | null, w: number, h: number, needsStrike = false) {
    this.launch = launch;
    this.w = w;
    this.h = h;
    this.needsStrike = needsStrike;
    this.s = w / 320; // pixel scale relative to a 320-wide frame
    this.maxArea = 90 * this.s * this.s;
  }

  /** The microphone heard the strike. */
  strike(t: number) {
    if (this.state === 'armed') this.strikeAt = t;
  }

  private isBallish(b: Blob) {
    return b.area >= 1 && b.area <= this.maxArea && Math.max(b.w, b.h) <= 18 * this.s;
  }

  feed(blobs: Blob[], t: number) {
    if (this.state === 'done') return;
    if (this.state === 'armed') return this.lookForLaunch(blobs, t);
    this.follow(blobs, t);
  }

  private lookForLaunch(blobs: Blob[], t: number) {
    if (this.needsStrike) {
      if (this.strikeAt == null) return;
      if (t - this.strikeAt > 0.6) {
        // heard something but no ball left the spot: re-arm
        this.strikeAt = null;
        this.pending = null;
        return;
      }
    }
    if (!this.launch) return this.lookForLaunchAuto(blobs, t);
    const L = this.launch;
    const cands = blobs.filter(
      (b) => this.isBallish(b) && b.y < L.y - 2 * this.s && Math.abs(b.x - L.x) < this.w * 0.3 && L.y - b.y < this.h * 0.35,
    );
    if (!this.pending) {
      // first sighting: the blob nearest the ball's spot that has clearly left it
      const c = cands
        .map((b) => ({ b, d: Math.hypot(b.x - L.x, b.y - L.y) }))
        .filter((e) => e.d > 3 * this.s && e.d < this.h * 0.25)
        .sort((a, b) => a.d - b.d)[0];
      if (c) this.pending = { t, x: c.b.x, y: c.b.y };
      return;
    }
    // second sighting must continue the same way, further out and still climbing
    const p = this.pending;
    const dx = p.x - L.x, dy = p.y - L.y;
    const len = Math.hypot(dx, dy) || 1;
    const next = cands
      .map((b) => {
        const along = ((b.x - L.x) * dx + (b.y - L.y) * dy) / len;
        const off = Math.abs((b.x - L.x) * dy - (b.y - L.y) * dx) / len;
        return { b, along, off };
      })
      .filter((e) => e.along > len * 1.3 && e.off < Math.max(8 * this.s, e.along * 0.35) && e.b.y < p.y)
      .sort((a, b) => a.off - b.off)[0];
    if (!next) {
      if (t - p.t > 0.12) this.pending = null; // lost it: start again
      return;
    }
    // Work back to when it left the tee from its speed over the two sightings
    const speed = (next.along - len) / (t - p.t || 1 / 30);
    const t0 = p.t - len / Math.max(speed, 1e-3);
    this.pts = [{ t: t0, x: L.x, y: L.y }, p, { t, x: next.b.x, y: next.b.y }];
    this.state = 'tracking';
    this.misses = 0;
  }

  private autoHist: TrackPoint[][] = [];

  /**
   * No tap: after the strike, look for three frames in a row where something
   * small moves up and away at a steady speed. (Each moving ball shows up
   * twice in a frame difference, where it is and where it was, so a single
   * pair of sightings isn't enough to be sure.)
   */
  private lookForLaunchAuto(blobs: Blob[], t: number) {
    if (this.strikeAt == null) return;
    const small = blobs
      .filter((b) => this.isBallish(b) && b.y > this.h * 0.15)
      .slice(0, 40)
      .map((b) => ({ t, x: b.x, y: b.y }));
    const [f1, f2] = this.autoHist;
    let best: { c: TrackPoint[]; score: number } | null = null;
    if (f1 && f2) {
      const s = this.s;
      for (const p1 of f1) {
        if (this.hint && Math.hypot(p1.x - this.hint.x, p1.y - this.hint.y) < 2.5 * s) continue; // the empty spot the ball just left
        for (const p2 of f2) {
          const v1x = p2.x - p1.x,
            v1y = p2.y - p1.y;
          const sp1 = Math.hypot(v1x, v1y);
          if (v1y > -1.2 * s || sp1 < 2 * s || sp1 > this.h * 0.2 || Math.abs(v1x) > -v1y * 1.2) continue;
          for (const p3 of small) {
            const v2x = p3.x - p2.x,
              v2y = p3.y - p2.y;
            if (v2y > -0.5 * s) continue;
            const jerk = Math.hypot(v2x - v1x, v2y - v1y);
            if (jerk > 0.45 * sp1 + 2 * s) continue;
            const fromHint = this.hint ? Math.hypot(p1.x - this.hint.x, p1.y - this.hint.y) / s : 0;
            const score = jerk / s + fromHint * 0.3;
            if (!best || score < best.score) best = { c: [p1, p2, p3], score };
          }
        }
      }
    }
    if (best) {
      const [p1, p2, p3] = best.c;
      const dt = p2.t - p1.t || 1 / 30;
      const vx = (p2.x - p1.x) / dt,
        vy = (p2.y - p1.y) / dt;
      let origin: Pt;
      let t0: number;
      // The ball sat at the address spot if the flight starts above it; impact is when we heard it
      if (this.hint && p1.y < this.hint.y && Math.hypot(p1.x - this.hint.x, p1.y - this.hint.y) < this.h * 0.3) {
        origin = this.hint;
        t0 = Math.min(this.strikeAt, p1.t - 1 / 60);
      } else {
        t0 = this.strikeAt;
        origin = { x: p1.x - vx * (p1.t - t0), y: p1.y - vy * (p1.t - t0) };
      }
      this.launch = origin;
      this.pts = [{ t: t0, x: origin.x, y: origin.y }, p1, p2, p3];
      this.state = 'tracking';
      this.misses = 0;
      return;
    }
    if (t - this.strikeAt > 0.6) {
      this.strikeAt = null;
      this.autoHist = [];
      return;
    }
    this.autoHist = [f2 ?? [], small].filter(Boolean) as TrackPoint[][];
    if (!f2) this.autoHist = [[], small];
  }

  private follow(blobs: Blob[], t: number) {
    const pred = this.predictNext(t);
    const last = this.pts[this.pts.length - 1];
    const prev = this.pts[this.pts.length - 2];
    const step = Math.hypot(last.x - prev.x, last.y - prev.y) * ((t - last.t) / (last.t - prev.t || 1 / 30));
    const gate = Math.max(8 * this.s, step * 0.9);
    const best = blobs
      .filter((b) => this.isBallish(b))
      .map((b) => ({ b, d: Math.hypot(b.x - pred.x, b.y - pred.y) }))
      .filter((e) => e.d < gate)
      .sort((a, b) => a.d - b.d)[0];
    if (best) {
      this.pts.push({ t, x: best.b.x, y: best.b.y });
      this.misses = 0;
    } else {
      this.misses++;
    }
    const offFrame = pred.x < -10 || pred.x > this.w + 10 || pred.y < -10;
    if (this.misses > 8 || offFrame || t - this.pts[0].t > 8) this.state = 'done';
  }

  /**
   * Where the ball should be at time t. Seen from behind, a ball flying away
   * slows down on screen frame by frame (it's getting further away), so we
   * carry on the last step, shrunk by how much the steps have been shrinking.
   */
  private predictNext(t: number): Pt {
    const n = this.pts.length;
    const a = this.pts[n - 1];
    const b = this.pts[n - 2];
    const c = this.pts[n - 3];
    const dt = a.t - b.t || 1 / 30;
    let vx = (a.x - b.x) / dt,
      vy = (a.y - b.y) / dt;
    if (c && c !== this.pts[0]) {
      const dt0 = b.t - c.t || 1 / 30;
      const s0 = Math.hypot(b.x - c.x, b.y - c.y) / dt0;
      const s1 = Math.hypot(vx, vy);
      const decay = Math.max(0.5, Math.min(1.1, s1 / (s0 || 1)));
      const k = Math.pow(decay, (t - a.t) / dt);
      vx *= k;
      vy *= k;
    }
    return { x: a.x + vx * (t - a.t), y: a.y + vy * (t - a.t) };
  }

  /** The best estimate of the whole flight so far (null until a launch is seen). */
  flight(): Flight | null {
    if (this.pts.length < 2) return null;
    const t0 = this.pts[0].t;
    const ts = this.pts.map((p) => p.t - t0);
    const fx = fitQuad(ts, this.pts.map((p) => p.x));
    let fy = fitQuad(ts, this.pts.map((p) => p.y));
    // Screen y grows downward; gravity means c > 0. If we haven't seen the
    // curve yet (only the first few frames), assume a typical apex time.
    const typicalApex = 2.6;
    if (fy[2] <= 0 || this.pts.length < 5) {
      const b = fy[1] < 0 ? fy[1] : -this.h * 0.4;
      fy = [fy[0], b, -b / (2 * typicalApex)];
    }
    const tApexRel = Math.max(0.3, -fy[1] / (2 * fy[2]));
    const yAt = (u: number) => fy[0] + fy[1] * u + fy[2] * u * u;
    const xAt = (u: number) => fx[0] + fx[1] * u + fx[2] * u * u;
    const apexY = yAt(tApexRel);
    // Seen from behind, the ball comes down well above where it started (it's far away).
    const startY = this.launch?.y ?? this.pts[0].y;
    const landY = startY - 0.35 * (startY - apexY);
    const disc = fy[1] * fy[1] - 4 * fy[2] * (fy[0] - landY);
    let tEndRel = disc > 0 ? (-fy[1] + Math.sqrt(disc)) / (2 * fy[2]) : tApexRel * 1.8;
    const lastRel = ts[ts.length - 1];
    if (tEndRel < lastRel) tEndRel = lastRel;
    tEndRel = Math.min(tEndRel, 9);
    return {
      t0,
      tApex: t0 + Math.min(tApexRel, tEndRel),
      tEnd: t0 + tEndRel,
      at: (t: number) => {
        const u = Math.max(0, Math.min(tEndRel, t - t0));
        return { x: xAt(u), y: yAt(u) };
      },
      tracked: this.pts,
    };
  }
}

/** Sharp-sound detector for the strike: a peak well above the background noise. */
export class StrikeDetector {
  private floor = 0.02;
  private lastHit = -10;
  feed(peak: number, t: number): boolean {
    const hit = peak > 0.25 && peak > this.floor * 6 && t - this.lastHit > 1.5;
    this.floor = this.floor * 0.97 + Math.min(peak, 0.3) * 0.03;
    if (hit) this.lastHit = t;
    return hit;
  }
}

/**
 * Spot a golf ball sitting at address: a small, bright, roundish blob in the
 * lower half of the picture, nearest the bottom middle.
 */
export function findBallAtAddress(gray: Uint8Array, w: number, h: number): Pt | null {
  const s = w / 320;
  const mask = new Uint8Array(w * h);
  // local contrast: much brighter than the ground a few pixels away
  const off = Math.max(3, Math.round(4 * s));
  for (let y = Math.floor(h * 0.45); y < h - off; y++) {
    for (let x = off; x < w - off; x++) {
      const i = y * w + x;
      const v = gray[i];
      if (v < 170) continue;
      const around = (gray[i - off] + gray[i + off] + gray[i - off * w] + gray[i + off * w]) / 4;
      if (v - around > 45) mask[i] = 1;
    }
  }
  // A ball 1.5 to 5 m in front of a phone camera is a few pixels across: radius ≈ 0.003–0.011 × the long side
  const M = Math.max(w, h);
  const minArea = Math.max(2, Math.PI * (0.003 * M) ** 2 * 0.4);
  const maxArea = Math.PI * (0.011 * M) ** 2 * 1.3;
  const zero = new Uint8Array(w * h);
  const blobs = diffBlobs(zero, mask.map((m) => m * 255), w, h, 100, maxArea).filter(
    (b) => b.area >= minArea && b.y > h * 0.55 && Math.max(b.w, b.h) / Math.min(b.w, b.h) < 2.2,
  );
  const target = { x: w / 2, y: h * 0.85 };
  const best = blobs.map((b) => ({ b, d: Math.hypot(b.x - target.x, b.y - target.y) })).sort((a, b) => a.d - b.d)[0];
  return best ? { x: best.b.x, y: best.b.y } : null;
}
