import type { LatLon } from '../types';
import { bearingDeg, distanceM, pointInPolygon } from './geo';
import { fromMerc, toMerc, type Dem } from './greenDem';

/**
 * Reading a green from the height grid: slope and fall at any spot, a slope
 * map, contour lines, how a putt breaks, and where to miss an approach.
 */
export interface Slope {
  /** Percent (rise over run × 100). */
  pct: number;
  /** Direction the ground falls towards, degrees true. */
  downhillDeg: number;
  /** Uphill gradient, east and north components (m per m). */
  gx: number;
  gy: number;
}

/** Smooth the grid a little (LiDAR has a few cm of noise). */
export function smooth(dem: Dem): Dem {
  const { w, h, z } = dem;
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      let s = 0;
      let n = 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue;
          const v = z[jj * w + ii];
          if (Number.isNaN(v)) continue;
          const wt = di === 0 && dj === 0 ? 4 : di === 0 || dj === 0 ? 2 : 1;
          s += v * wt;
          n += wt;
        }
      out[j * w + i] = n ? s / n : NaN;
    }
  return { ...dem, z: out };
}

/** Grid position (fractional cell coordinates) of a point. */
function cellOf(dem: Dem, p: LatLon) {
  const m = toMerc(p);
  return { i: ((m.x - dem.xmin) / (dem.xmax - dem.xmin)) * dem.w - 0.5, j: ((dem.ymax - m.y) / (dem.ymax - dem.ymin)) * dem.h - 0.5 };
}

export function cellCentre(dem: Dem, i: number, j: number): LatLon {
  return fromMerc(dem.xmin + ((i + 0.5) / dem.w) * (dem.xmax - dem.xmin), dem.ymax - ((j + 0.5) / dem.h) * (dem.ymax - dem.ymin));
}

/** Height at a point (bilinear), or NaN off the grid. */
export function heightAt(dem: Dem, p: LatLon): number {
  const { i, j } = cellOf(dem, p);
  const i0 = Math.floor(i);
  const j0 = Math.floor(j);
  if (i0 < 0 || j0 < 0 || i0 + 1 >= dem.w || j0 + 1 >= dem.h) return NaN;
  const fx = i - i0;
  const fy = j - j0;
  const at = (a: number, b: number) => dem.z[b * dem.w + a];
  return (
    at(i0, j0) * (1 - fx) * (1 - fy) + at(i0 + 1, j0) * fx * (1 - fy) + at(i0, j0 + 1) * (1 - fx) * fy + at(i0 + 1, j0 + 1) * fx * fy
  );
}

/** Slope at a point, from heights one cell either side. */
export function slopeAt(dem: Dem, p: LatLon): Slope | null {
  const { i, j } = cellOf(dem, p);
  const ii = Math.round(i);
  const jj = Math.round(j);
  if (ii < 1 || jj < 1 || ii >= dem.w - 1 || jj >= dem.h - 1) return null;
  const at = (a: number, b: number) => dem.z[b * dem.w + a];
  // Over about 2 m either side (LiDAR noise makes 1 m slopes jumpy), or 1 cell at the edge
  const k = Math.max(1, Math.min(Math.round(2 / dem.cellM), ii, jj, dem.w - 1 - ii, dem.h - 1 - jj));
  const gx = (at(ii + k, jj) - at(ii - k, jj)) / (2 * k * dem.cellM);
  const gy = (at(ii, jj - k) - at(ii, jj + k)) / (2 * k * dem.cellM); // row 0 is north
  if (!Number.isFinite(gx) || !Number.isFinite(gy)) return null;
  return toSlope(gx, gy);
}

function toSlope(gx: number, gy: number): Slope {
  const pct = Math.hypot(gx, gy) * 100;
  const downhillDeg = (Math.atan2(-gx, -gy) * 180) / Math.PI;
  return { pct, downhillDeg: (downhillDeg + 360) % 360, gx, gy };
}

/** Average slope within `r` metres of a point. */
export function slopeAround(dem: Dem, p: LatLon, r = 3): Slope | null {
  let gx = 0;
  let gy = 0;
  let n = 0;
  const steps = 4;
  for (let a = 0; a < steps; a++)
    for (const f of [0, 0.5, 1]) {
      const ang = (a / steps) * 2 * Math.PI;
      const q = offset(p, r * f * Math.sin(ang), r * f * Math.cos(ang));
      const s = slopeAt(dem, q);
      if (s) {
        gx += s.gx;
        gy += s.gy;
        n++;
      }
    }
  return n ? toSlope(gx / n, gy / n) : null;
}

function offset(p: LatLon, east: number, north: number): LatLon {
  return { lat: p.lat + north / 111320, lon: p.lon + east / (111320 * Math.cos((p.lat * Math.PI) / 180)) };
}

/** Slope of every cell on the green (for the colour map and arrows). */
export function greenCells(dem: Dem, poly: LatLon[] | undefined, centre: LatLon) {
  const out: { i: number; j: number; at: LatLon; s: Slope }[] = [];
  for (let j = 1; j < dem.h - 1; j++)
    for (let i = 1; i < dem.w - 1; i++) {
      const at = cellCentre(dem, i, j);
      // Keep 1.5 m inside the outline: mapped outlines are a little rough and the
      // edges catch bunker faces and banks, which aren't the putting surface
      const inside = (q: LatLon) => (poly && poly.length >= 3 ? pointInPolygon(q, poly) : distanceM(q, centre) < 14);
      if (!inside(at)) continue;
      const e = 1.5;
      if (![offset(at, e, 0), offset(at, -e, 0), offset(at, 0, e), offset(at, 0, -e)].every(inside)) continue;
      const s = slopeAt(dem, at);
      if (s) out.push({ i, j, at, s });
    }
  return out;
}

/** Overall tilt of the green and the steepest part. */
export function greenSummary(cells: ReturnType<typeof greenCells>) {
  if (!cells.length) return null;
  const gx = cells.reduce((a, c) => a + c.s.gx, 0) / cells.length;
  const gy = cells.reduce((a, c) => a + c.s.gy, 0) / cells.length;
  const sorted = cells.map((c) => c.s.pct).sort((a, b) => a - b);
  return { tilt: toSlope(gx, gy), p90: sorted[Math.floor(sorted.length * 0.9)], max: sorted[sorted.length - 1] };
}

/** Colour for a slope: flat green → yellow (2%) → orange (3%) → red (4.5%+). */
export function slopeColour(pct: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0, [34, 197, 94]],
    [2, [234, 220, 50]],
    [3, [249, 140, 30]],
    [4.5, [220, 38, 38]],
    [6, [150, 20, 60]],
  ];
  for (let k = 1; k < stops.length; k++) {
    const [p1, c1] = stops[k];
    const [p0, c0] = stops[k - 1];
    if (pct <= p1) {
      const t = (pct - p0) / (p1 - p0);
      return [0, 1, 2].map((q) => Math.round(c0[q] + (c1[q] - c0[q]) * t)) as [number, number, number];
    }
  }
  return stops[stops.length - 1][1];
}

/** Contour lines (marching squares) every `step` metres, as lat/lon segments. */
export function contours(dem: Dem, step = 0.1): { level: number; segs: [LatLon, LatLon][] }[] {
  const { w, h, z } = dem;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of z) if (!Number.isNaN(v)) [lo, hi] = [Math.min(lo, v), Math.max(hi, v)];
  if (!Number.isFinite(lo)) return [];
  // Keep it readable: no more than ~14 lines across the area
  while ((hi - lo) / step > 14) step *= 2;
  const out: { level: number; segs: [LatLon, LatLon][] }[] = [];
  const pt = (i: number, j: number) => cellCentre(dem, i, j);
  const lerp = (a: LatLon, b: LatLon, t: number): LatLon => ({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t });
  for (let level = Math.ceil(lo / step) * step; level < hi; level += step) {
    const segs: [LatLon, LatLon][] = [];
    for (let j = 0; j < h - 1; j++)
      for (let i = 0; i < w - 1; i++) {
        const v = [z[j * w + i], z[j * w + i + 1], z[(j + 1) * w + i + 1], z[(j + 1) * w + i]];
        if (v.some(Number.isNaN)) continue;
        const c = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)];
        const cross: LatLon[] = [];
        for (let e = 0; e < 4; e++) {
          const a = v[e];
          const b = v[(e + 1) % 4];
          if ((a < level) !== (b < level)) cross.push(lerp(c[e], c[(e + 1) % 4], (level - a) / (b - a)));
        }
        if (cross.length === 2) segs.push([cross[0], cross[1]]);
        else if (cross.length === 4) segs.push([cross[0], cross[1]], [cross[2], cross[3]]);
      }
    if (segs.length) out.push({ level, segs });
  }
  return out;
}

export interface PuttRead {
  distanceM: number;
  /** Hole minus ball height, cm (positive = uphill). */
  riseCm: number;
  /** Side slope across the line, % (positive = ground higher on the right, so it breaks left). */
  sidePct: number;
  /** Estimated break at the hole, cm (sign as sidePct: positive = breaks left). */
  breakCm: number;
  text: string;
}

/**
 * How a putt from `ball` to `hole` breaks. The break is a rule-of-thumb
 * estimate for medium-paced greens (about 10 on the stimp): it grows with
 * the side slope and a bit faster than the length, more downhill, less uphill.
 */
export function readPutt(dem: Dem, ball: LatLon, hole: LatLon): PuttRead | null {
  const d = distanceM(ball, hole);
  if (d < 0.8) return null;
  const zb = heightAt(dem, ball);
  const zh = heightAt(dem, hole);
  if (!Number.isFinite(zb) || !Number.isFinite(zh)) return null;
  const brg = (bearingDeg(ball, hole) * Math.PI) / 180;
  // unit vector to the right of the line (east, north)
  const rx = Math.cos(brg);
  const ry = -Math.sin(brg);
  let side = 0;
  let n = 0;
  for (const f of [0.2, 0.4, 0.6, 0.8, 0.95]) {
    const q = { lat: ball.lat + (hole.lat - ball.lat) * f, lon: ball.lon + (hole.lon - ball.lon) * f };
    const s = slopeAt(dem, q);
    if (s) {
      // weight the slow end of the putt (near the hole) more
      const wt = 0.5 + f;
      side += (s.gx * rx + s.gy * ry) * wt;
      n += wt;
    }
  }
  if (!n) return null;
  const sidePct = (side / n) * 100;
  const riseCm = (zh - zb) * 100;
  const alongPct = (riseCm / 100 / d) * 100;
  const speed = Math.max(0.6, Math.min(1.5, 1 - alongPct * 0.12));
  const breakCm = 1.8 * sidePct * Math.pow(d, 1.3) * speed;
  return { distanceM: d, riseCm, sidePct, breakCm, text: puttText(d, riseCm, breakCm) };
}

function puttText(d: number, riseCm: number, breakCm: number) {
  const parts: string[] = [];
  const r = Math.round(riseCm);
  if (Math.abs(r) >= 3) parts.push(r > 0 ? `${r} cm uphill, give it a bit more` : `${-r} cm downhill, just die it in`);
  else parts.push('about level');
  const b = Math.abs(breakCm);
  const cups = b / 10.8;
  if (b < 4) parts.push('straight');
  else if (cups > 4) parts.push(`big break ${breakCm > 0 ? 'right to left' : 'left to right'}, more than 4 cups: trust your eyes on this one`);
  else {
    const dir = breakCm > 0 ? 'right to left' : 'left to right';
    const aim = breakCm > 0 ? 'right' : 'left';
    parts.push(`breaks ${dir}, aim about ${cups < 0.9 ? `${Math.round(b)} cm` : `${cupsLabel(cups)} cup${cups >= 1.5 ? 's' : ''}`} ${aim} of the hole`);
  }
  return `${d.toFixed(1)} m putt: ${parts.join('; ')}`;
}

function cupsLabel(c: number) {
  const half = Math.round(c * 2) / 2;
  return half % 1 ? `${Math.floor(half) || ''}½` : String(half);
}

/** Where to miss an approach, from how the green falls around the pin. */
export function approachNote(dem: Dem, pin: LatLon, from: LatLon): string | null {
  const s = slopeAround(dem, pin, 3);
  if (!s) return null;
  // Putting surfaces are rarely steeper than ~5%; steeper means the pin or green outline is off
  if (s.pct > 6) return null;
  if (s.pct < 0.8) return `Green is flat around the pin (${s.pct.toFixed(1)}%), so any side of the hole is fine.`;
  const toPin = bearingDeg(from, pin);
  // angle of the fall relative to the line of play: 0 = falls away from you, 180 = towards you
  const rel = (((s.downhillDeg - toPin) % 360) + 360) % 360;
  const pct = s.pct.toFixed(1);
  if (rel > 135 && rel < 225) return `Green falls back to front around the pin (${pct}%): stay below the hole and leave an uphill putt. Long is the worst miss.`;
  if (rel < 45 || rel > 315) return `Green falls away from you around the pin (${pct}%): land it short and let it run. Past the pin is a quick putt back.`;
  const low = rel < 180 ? 'right' : 'left';
  return `Green falls ${low === 'right' ? 'left to right' : 'right to left'} around the pin (${pct}%): miss on the ${low} (low) side for an uphill putt.`;
}
