import type { Green, LatLon } from '../types';

const R = 6371008.8; // mean Earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in metres. */
export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees true (0 = north, 90 = east). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Local east/north offset of p from origin, metres (fine over a golf hole). */
export function toLocal(origin: LatLon, p: LatLon): { x: number; y: number } {
  const x = rad(p.lon - origin.lon) * R * Math.cos(rad(origin.lat));
  const y = rad(p.lat - origin.lat) * R;
  return { x, y };
}

export function fromLocal(origin: LatLon, x: number, y: number): LatLon {
  return {
    lat: origin.lat + deg(y / R),
    lon: origin.lon + deg(x / (R * Math.cos(rad(origin.lat)))),
  };
}

/** Area-weighted centroid of a polygon. */
export function centroid(poly: LatLon[]): LatLon {
  if (poly.length === 0) throw new Error('empty polygon');
  const o = poly[0];
  let a = 0;
  let cx = 0;
  let cy = 0;
  const pts = poly.map((p) => toLocal(o, p));
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    // degenerate, fall back to vertex average
    const lat = poly.reduce((s, p) => s + p.lat, 0) / poly.length;
    const lon = poly.reduce((s, p) => s + p.lon, 0) / poly.length;
    return { lat, lon };
  }
  a /= 2;
  return fromLocal(o, cx / (6 * a), cy / (6 * a));
}

export function pointInPolygon(p: LatLon, poly: LatLon[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (
      a.lat > p.lat !== b.lat > p.lat &&
      p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export interface GreenDistances {
  front: number;
  centre: number;
  back: number;
  /** Distance to the pin if one has been set for the hole, otherwise centre. */
  pin: number;
  pinIsSet: boolean;
  /** Bearing from player to the target, degrees true. */
  bearing: number;
}

/**
 * Front / centre / back distances along the player's line of play.
 * Front and back are where the line from the player through the green's
 * centre enters and leaves the green outline. Without an outline we assume
 * a typical 28 m deep green.
 */
export function greenDistances(player: LatLon, green: Green, pin?: LatLon): GreenDistances {
  const centre = green.centre;
  const centreD = distanceM(player, centre);
  const bearing = bearingDeg(player, pin ?? centre);
  let front = centreD - 14;
  let back = centreD + 14;
  if (green.polygon && green.polygon.length >= 3) {
    const c = toLocal(player, centre);
    const len = Math.hypot(c.x, c.y) || 1;
    const ux = c.x / len;
    const uy = c.y / len;
    // Intersect the ray player->centre with each polygon edge.
    const hits: number[] = [];
    const pts = green.polygon.map((p) => toLocal(player, p));
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const denom = ux * ey - uy * ex;
      if (Math.abs(denom) < 1e-12) continue;
      const t = (a.x * ey - a.y * ex) / denom; // distance along ray
      const s = (a.x * uy - a.y * ux) / denom; // position along edge
      if (s >= 0 && s <= 1 && t >= 0) hits.push(t);
    }
    if (hits.length >= 2) {
      front = Math.min(...hits);
      back = Math.max(...hits);
    } else if (hits.length === 1) {
      // Player is standing on the green.
      front = 0;
      back = hits[0];
    }
  }
  const pinD = pin ? distanceM(player, pin) : centreD;
  return {
    front: Math.max(0, front),
    centre: centreD,
    back,
    pin: pinD,
    pinIsSet: !!pin,
    bearing,
  };
}

/** Length of a polyline in metres. */
export function pathLength(points: LatLon[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += distanceM(points[i - 1], points[i]);
  return d;
}

export const M_TO_YD = 1.0936133;

export function fmtDist(m: number, units: 'm' | 'yd'): string {
  const v = units === 'yd' ? m * M_TO_YD : m;
  return `${Math.round(v)}`;
}
