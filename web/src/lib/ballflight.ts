/**
 * Ball-flight physics and camera geometry for the "sim" shot tracer.
 *
 * World frame (metres): x = right of the target line, d = down the target
 * line, z = up. The ball starts at the origin. The phone sits behind the ball
 * looking down the target line.
 *
 * We fit a physical flight (speed, launch angle, spin lift, start direction,
 * curve) so that, seen through the phone's camera, it matches the ball path the
 * tracker saw. The fitted flight then gives carry, apex and landing, and draws
 * the rest of the tracer.
 */

export interface ShotParams {
  v0: number; // ball speed, m/s
  launch: number; // launch angle, degrees
  lift: number; // spin lift coefficient
  dir: number; // start direction, degrees (+ = right)
  curve: number; // sideways acceleration, m/s² (+ = curving right)
}

export interface Sample {
  t: number;
  x: number;
  d: number;
  z: number;
}

const K = (1.2 * 0.001432) / (2 * 0.0459); // air density × area / (2 × mass)
const CD = 0.25;

/** Integrate a flight until it lands (or 12 s). */
export function simulate(p: ShotParams, dt = 0.005): Sample[] {
  const la = (p.launch * Math.PI) / 180;
  const da = (p.dir * Math.PI) / 180;
  let vx = p.v0 * Math.cos(la) * Math.sin(da);
  let vd = p.v0 * Math.cos(la) * Math.cos(da);
  let vz = p.v0 * Math.sin(la);
  let x = 0,
    d = 0,
    z = 0,
    t = 0;
  const out: Sample[] = [{ t, x, d, z }];
  while (t < 12) {
    const v = Math.hypot(vx, vd, vz);
    const hv = Math.hypot(vx, vd) || 1e-9;
    const lz = K * p.lift * v * hv;
    const lh = -K * p.lift * v * vz;
    const ax = -K * CD * v * vx + (lh * vx) / hv + p.curve;
    const ad = -K * CD * v * vd + (lh * vd) / hv;
    const az = -9.81 - K * CD * v * vz + lz;
    vx += ax * dt;
    vd += ad * dt;
    vz += az * dt;
    const nz = z + vz * dt;
    if (nz < 0 && t > 0.1) {
      // land exactly on the ground
      const f = z / (z - nz);
      out.push({ t: t + f * dt, x: x + vx * dt * f, d: d + vd * dt * f, z: 0 });
      break;
    }
    x += vx * dt;
    d += vd * dt;
    z = nz;
    t += dt;
    out.push({ t, x, d, z });
  }
  return out;
}

export function sampleAt(path: Sample[], t: number): Sample {
  if (t <= 0) return path[0];
  const last = path[path.length - 1];
  if (t >= last.t) return last;
  let lo = 0,
    hi = path.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (path[m].t <= t) lo = m;
    else hi = m;
  }
  const a = path[lo],
    b = path[hi];
  const f = (t - a.t) / (b.t - a.t || 1);
  return { t, x: a.x + (b.x - a.x) * f, d: a.d + (b.d - a.d) * f, z: a.z + (b.z - a.z) * f };
}

/** A pinhole camera that can only pitch up/down, looking down the target line. */
export interface Camera {
  w: number;
  h: number;
  /** Focal length in pixels. */
  F: number;
  /** Camera tilt, radians (+ = pointing up). */
  pitch: number;
  /** Camera position relative to the ball, metres. */
  cx: number;
  cd: number;
  cz: number;
}

/** iPhone main camera: about 68° across the long side of a 16:9 video. */
export const DEFAULT_FOV_LONG = 68;
/** Phone leaning on a golf bag. */
export const DEFAULT_CAMERA_HEIGHT = 1.0;

export function project(cam: Camera, p: { x: number; d: number; z: number }): { x: number; y: number; depth: number } {
  const rx = p.x - cam.cx,
    rd = p.d - cam.cd,
    rz = p.z - cam.cz;
  const cp = Math.cos(cam.pitch),
    sp = Math.sin(cam.pitch);
  const Z = rd * cp + rz * sp; // forward
  const Y = -rd * sp + rz * cp; // up
  const depth = Math.max(Z, 0.05);
  return { x: cam.w / 2 + (cam.F * rx) / depth, y: cam.h / 2 - (cam.F * Y) / depth, depth };
}

/**
 * Work out where the camera is from where the ball sits in the picture:
 * the ray through the ball's pixel must hit the ground at the ball.
 */
export function makeCamera(w: number, h: number, pitchDeg: number, ball: { x: number; y: number }, fovLongDeg = DEFAULT_FOV_LONG, height = DEFAULT_CAMERA_HEIGHT): Camera {
  const F = Math.max(w, h) / 2 / Math.tan((fovLongDeg * Math.PI) / 360);
  const pitch = (pitchDeg * Math.PI) / 180;
  // Ray in camera coords → world (d forward, z up)
  const X = (ball.x - w / 2) / F;
  const Y = -(ball.y - h / 2) / F;
  const cp = Math.cos(pitch),
    sp = Math.sin(pitch);
  const rd = cp - Y * sp;
  const rz = sp + Y * cp;
  // From camera height, travel along the ray until z = 0
  const s = rz < -1e-3 ? height / -rz : height / 0.35; // ball above horizon? fall back to ~3 m
  return { w, h, F, pitch, cx: -X * s, cd: -rd * s, cz: height };
}

/** Pitch of the back camera from device orientation (degrees, + = pointing up). */
export function cameraPitchFromOrientation(betaDeg: number, gammaDeg: number): number {
  const b = (betaDeg * Math.PI) / 180,
    g = (gammaDeg * Math.PI) / 180;
  return (Math.asin(Math.max(-1, Math.min(1, -Math.cos(b) * Math.cos(g)))) * 180) / Math.PI;
}

// ---------- fitting ----------

export interface Obs {
  t: number; // seconds since launch
  x: number;
  y: number;
}

const BOUNDS: [keyof ShotParams | 'dt0', number, number][] = [
  ['v0', 15, 85],
  ['launch', 4, 45],
  ['lift', 0.08, 0.32],
  ['dir', -25, 25],
  ['curve', -6, 6],
  ['dt0', -0.12, 0.12], // correction to the impact time (the microphone is only read once a frame)
];

function clampParams(v: number[]): ShotParams & { dt0: number } {
  const o = {} as ShotParams & { dt0: number };
  BOUNDS.forEach(([k, lo, hi], i) => (o[k] = Math.max(lo, Math.min(hi, v[i] ?? 0))));
  return o;
}

function nelderMead(f: (v: number[]) => number, start: number[], steps: number[], iters = 400): number[] {
  const n = start.length;
  let simplex = [start, ...steps.map((s, i) => start.map((v, j) => (j === i ? v + s : v)))];
  let vals = simplex.map(f);
  for (let it = 0; it < iters; it++) {
    const order = vals.map((_, i) => i).sort((a, b) => vals[a] - vals[b]);
    simplex = order.map((i) => simplex[i]);
    vals = order.map((i) => vals[i]);
    const centroid = Array.from({ length: n }, (_, j) => simplex.slice(0, n).reduce((s, p) => s + p[j], 0) / n);
    const worst = simplex[n];
    const refl = centroid.map((c, j) => c + (c - worst[j]));
    const fr = f(refl);
    if (fr < vals[0]) {
      const exp = centroid.map((c, j) => c + 2 * (c - worst[j]));
      const fe = f(exp);
      [simplex[n], vals[n]] = fe < fr ? [exp, fe] : [refl, fr];
    } else if (fr < vals[n - 1]) {
      [simplex[n], vals[n]] = [refl, fr];
    } else {
      const con = centroid.map((c, j) => c + 0.5 * (worst[j] - c));
      const fc = f(con);
      if (fc < vals[n]) [simplex[n], vals[n]] = [con, fc];
      else {
        simplex = simplex.map((p) => p.map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j])));
        vals = simplex.map(f);
      }
    }
    if (Math.abs(vals[n] - vals[0]) < 1e-6) break;
  }
  return simplex[vals.indexOf(Math.min(...vals))];
}

/**
 * Typical club-golfer ball speed (m/s) and launch angle (°) by club. Used as a
 * soft starting point: the camera pins down launch, direction and curve well,
 * but ball speed is hard to see from behind, so the club fills that gap.
 */
export const CLUB_TYPICAL: { match: RegExp; v0: number; launch: number }[] = [
  { match: /^dr|driver/i, v0: 60, launch: 13 },
  { match: /3\s*w|3\s*wood/i, v0: 56, launch: 12 },
  { match: /5\s*w|7\s*w|wood/i, v0: 52, launch: 13 },
  { match: /hy|rescue|utility/i, v0: 50, launch: 14 },
  { match: /^3\s*i|3 iron/i, v0: 49, launch: 13 },
  { match: /^4\s*i|4 iron/i, v0: 48, launch: 14 },
  { match: /^5\s*i|5 iron/i, v0: 46, launch: 15 },
  { match: /^6\s*i|6 iron/i, v0: 44, launch: 16 },
  { match: /^7\s*i|7 iron/i, v0: 42, launch: 18 },
  { match: /^8\s*i|8 iron/i, v0: 40, launch: 20 },
  { match: /^9\s*i|9 iron/i, v0: 37, launch: 22 },
  { match: /^pw|pitching/i, v0: 34, launch: 25 },
  { match: /^gw|^aw|gap|approach/i, v0: 32, launch: 27 },
  { match: /^sw|sand/i, v0: 29, launch: 30 },
  { match: /^lw|lob/i, v0: 26, launch: 33 },
];

export function clubTypical(club?: string) {
  if (!club) return undefined;
  return CLUB_TYPICAL.find((c) => c.match.test(club.trim()));
}

/** Without a club, guess the typical speed for the launch angle we saw (lower launch = faster club). */
function speedForLaunch(launch: number): number {
  const pts = [...CLUB_TYPICAL].sort((a, b) => a.launch - b.launch);
  if (launch <= pts[0].launch) return pts[0].v0;
  for (let i = 1; i < pts.length; i++) {
    if (launch <= pts[i].launch) {
      const a = pts[i - 1],
        b = pts[i];
      return a.v0 + ((b.v0 - a.v0) * (launch - a.launch)) / (b.launch - a.launch || 1);
    }
  }
  return pts[pts.length - 1].v0;
}

export interface ShotResult {
  params: ShotParams;
  path: Sample[];
  carry: number;
  apex: number;
  hang: number;
  /** Where it landed relative to the target line, metres (+ = right). */
  lateral: number;
  startDir: number;
  /** Sideways movement caused by curve, metres (+ = curved right). */
  curveM: number;
  shape: string;
  /** Mean pixel error of the fit (lower = more trustworthy). */
  error: number;
}

export function shapeLabel(curveM: number, carry: number): string {
  const c = curveM / Math.max(carry, 1);
  if (Math.abs(c) < 0.025) return 'Straight';
  if (c > 0) return c > 0.09 ? 'Slice' : 'Fade';
  return c < -0.09 ? 'Hook' : 'Draw';
}

/**
 * Find the flight that best matches what the camera saw.
 * `landedAt` is the seconds-since-launch when the ball was seen to come down, if known.
 */
/**
 * `speedFactor` is how hard this golfer hits it compared with a typical club
 * golfer (1.1 = 10% more ball speed). It comes from calibration and carries
 * across all clubs.
 */
export function fitShot(
  cam: Camera,
  obs: Obs[],
  landedAt?: number,
  calibration = 1,
  club?: string,
  speedFactor = 1,
  opts: { quick?: boolean; straight?: boolean } = {},
): ShotResult | null {
  const first = fitCore(cam, obs, landedAt, calibration, club, speedFactor, opts);
  if (!first || obs.length < 7) return first;
  // If the tracker grabbed a wrong speck or two, drop the points that don't fit and try again
  const resid = obs.map((o) => {
    const q = project(cam, sampleAt(first.path, o.t));
    return Math.hypot(q.x - o.x, q.y - o.y);
  });
  const med = [...resid].sort((a, b) => a - b)[Math.floor(resid.length / 2)];
  const limit = Math.max(3, med * 4);
  const kept = obs.filter((_, i) => resid[i] <= limit);
  if (kept.length === obs.length || kept.length < 5) return first;
  const second = fitCore(cam, kept, landedAt, calibration, club, speedFactor, opts);
  return second && second.error < first.error ? second : first;
}

function fitCore(
  cam: Camera,
  obs: Obs[],
  landedAt: number | undefined,
  calibration: number,
  club: string | undefined,
  speedFactor: number,
  opts: { quick?: boolean; straight?: boolean },
): ShotResult | null {
  if (obs.length < 4) return null;
  const base = clubTypical(club);
  const typical = base ? { ...base, v0: base.v0 * speedFactor } : undefined;
  const cost = (v: number[]) => {
    const p = clampParams(v);
    const path = simulate(p, 0.01);
    let e = 0;
    for (const o of obs) {
      const q = project(cam, sampleAt(path, o.t - p.dt0));
      e += (q.x - o.x) ** 2 + (q.y - o.y) ** 2;
    }
    e /= obs.length;
    if (landedAt != null) e += ((path[path.length - 1].t - landedAt) * 20) ** 2;
    // keep the solution inside sensible golf shots
    const raw = v.map((x, i) => Math.max(0, BOUNDS[i][1] - x, x - BOUNDS[i][2]));
    // what golf shots usually look like: speed for the club (or for this launch angle), normal spin
    const vPrior = typical ? typical.v0 : speedForLaunch(p.launch) * speedFactor;
    const sd = typical ? 0.12 : 0.2;
    // Into a net the curve never gets a chance to show: hold it straight rather than guess
    const prior = ((p.v0 - vPrior) / (sd * vPrior)) ** 2 * 0.6 + ((p.lift - 0.21) / 0.04) ** 2 * 0.3 + (opts.straight ? (p.curve / 0.05) ** 2 : 0);
    return e + prior + raw.reduce((s, x) => s + x * x * 100, 0);
  };
  // The exact moment of impact is only known to within a frame or two, and the
  // answer is sensitive to it, so try each likely moment and keep the best fit.
  const startsFor = (dt0: number) =>
    typical
      ? [
          [typical.v0, typical.launch, 0.21, 0, 0, dt0],
          [typical.v0 * 1.1, typical.launch - 2, 0.19, 0, 0, dt0],
        ]
      : [
          [38, 26, 0.22, 0, 0, dt0],
          [50, 17, 0.21, 0, 0, dt0],
          [66, 12, 0.17, 0, 0, dt0],
        ];
  let best: number[] = startsFor(0)[0];
  let bestCost = Infinity;
  const step = opts.quick ? 0.022 : 0.011;
  const iters = opts.quick ? 140 : 220;
  for (let dt0 = -0.11; dt0 <= 0.1101; dt0 += step) {
    const fixed = (v: number[]) => cost([...v.slice(0, 5), dt0]);
    for (const st of startsFor(dt0)) {
      const v5 = nelderMead(fixed, st.slice(0, 5), [6, 4, 0.04, 3, 1.5], iters);
      const c = fixed(v5);
      if (c < bestCost) {
        bestCost = c;
        best = [...v5, dt0];
      }
    }
  }
  // final polish with the impact moment free
  best = nelderMead(cost, best, [2, 1, 0.01, 0.5, 0.3, 0.005], opts.quick ? 150 : 300);
  bestCost = cost(best);
  const { dt0, ...params } = clampParams(best);
  const path = simulate(params).map((q) => ({ ...q, t: q.t + dt0 }));
  const land = path[path.length - 1];
  const apex = path.reduce((a, b) => (b.z > a.z ? b : a));
  const straightLateral = land.d * Math.tan((params.dir * Math.PI) / 180);
  const curveM = (land.x - straightLateral) * calibration;
  const carry = Math.hypot(land.d, land.x) * calibration;
  return {
    params,
    path,
    carry,
    apex: apex.z * calibration,
    hang: land.t - dt0,
    lateral: land.x * calibration,
    startDir: params.dir,
    curveM,
    shape: shapeLabel(curveM, carry),
    error: Math.sqrt(Math.max(0, bestCost)),
  };
}

/**
 * Calibrate: find the speed factor that makes this shot carry what the golfer
 * says it really carried.
 */
export function solveSpeedFactor(cam: Camera, obs: Obs[], club: string | undefined, actualCarry: number, current = 1): number {
  let lo = 0.7,
    hi = 1.5;
  const carryAt = (f: number) => fitShot(cam, obs, undefined, 1, club, f, { quick: true })?.carry ?? 0;
  if (carryAt(lo) > actualCarry) return lo;
  if (carryAt(hi) < actualCarry) return hi;
  for (let i = 0; i < 6; i++) {
    const mid = (lo + hi) / 2;
    if (carryAt(mid) < actualCarry) lo = mid;
    else hi = mid;
  }
  void current;
  // one precise correction with the full fit (carry grows a little faster than ball speed)
  let f = (lo + hi) / 2;
  const full = fitShot(cam, obs, undefined, 1, club, f)?.carry;
  if (full) f *= Math.pow(actualCarry / full, 1 / 1.3);
  return Math.max(0.7, Math.min(1.5, f));
}
