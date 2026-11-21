import type { LatLon } from '../types';
import { fromLocal, toLocal } from './geo';

/**
 * A hole laid out on screen the way a golfer looks at it: the line of play
 * points straight up, tee at the bottom, green at the top.
 *
 * Screen coordinates are CSS pixels; u is metres right of the line of play,
 * v is metres along it.
 */
export interface Frame {
  origin: LatLon;
  /** Direction that points up the screen, degrees true. */
  upDeg: number;
  /** Pixels per metre. */
  scale: number;
  uc: number;
  vc: number;
  cx: number;
  cy: number;
}

export interface Pad {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const rad = (d: number) => (d * Math.PI) / 180;

function toUV(f: Pick<Frame, 'origin' | 'upDeg'>, p: LatLon) {
  const { x, y } = toLocal(f.origin, p);
  const t = rad(f.upDeg);
  return { u: x * Math.cos(t) - y * Math.sin(t), v: x * Math.sin(t) + y * Math.cos(t) };
}

/** Fit the points on screen with the line of play pointing up. */
export function makeFrame(opts: {
  origin: LatLon;
  upDeg: number;
  fit: LatLon[];
  width: number;
  height: number;
  pad: Pad;
  /** Smallest area to show, metres (stops a tiny green filling the screen). */
  minSpanM?: number;
  maxScale?: number;
}): Frame {
  const { origin, upDeg, width, height, pad } = opts;
  const pts = (opts.fit.length ? opts.fit : [origin]).map((p) => toUV({ origin, upDeg }, p));
  let umin = Math.min(...pts.map((p) => p.u));
  let umax = Math.max(...pts.map((p) => p.u));
  let vmin = Math.min(...pts.map((p) => p.v));
  let vmax = Math.max(...pts.map((p) => p.v));
  const min = opts.minSpanM ?? 60;
  if (umax - umin < min) [umin, umax] = [(umin + umax) / 2 - min / 2, (umin + umax) / 2 + min / 2];
  if (vmax - vmin < min) [vmin, vmax] = [(vmin + vmax) / 2 - min / 2, (vmin + vmax) / 2 + min / 2];
  const w = Math.max(40, width - pad.left - pad.right);
  const h = Math.max(40, height - pad.top - pad.bottom);
  const scale = Math.min(w / (umax - umin), h / (vmax - vmin), opts.maxScale ?? Infinity);
  return { origin, upDeg, scale, uc: (umin + umax) / 2, vc: (vmin + vmax) / 2, cx: pad.left + w / 2, cy: pad.top + h / 2 };
}

export function project(f: Frame, p: LatLon): { x: number; y: number } {
  const { u, v } = toUV(f, p);
  return { x: f.cx + (u - f.uc) * f.scale, y: f.cy - (v - f.vc) * f.scale };
}

export function unproject(f: Frame, x: number, y: number): LatLon {
  const u = f.uc + (x - f.cx) / f.scale;
  const v = f.vc - (y - f.cy) / f.scale;
  const t = rad(f.upDeg);
  return fromLocal(f.origin, u * Math.cos(t) + v * Math.sin(t), -u * Math.sin(t) + v * Math.cos(t));
}

/** Metres right of / along the line from `from` towards `bearing` (for hazard and arc maths). */
export function along(from: LatLon, bearing: number, p: LatLon) {
  return toUV({ origin: from, upDeg: bearing }, p);
}

// ---- Satellite tiles (Web Mercator), drawn turned to match the frame

const TILE = 256;
const EARTH_MPP0 = 156543.03392; // metres per pixel at zoom 0 on the equator

function mercator(p: LatLon, z: number) {
  const n = TILE * 2 ** z;
  const s = Math.sin(rad(p.lat));
  return { x: ((p.lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}

export interface TileLayout {
  z: number;
  /** Tile-pixel position of the frame origin (the matrix works relative to this). */
  ox: number;
  oy: number;
  /** SVG transform that puts tile pixel space on the screen. */
  matrix: string;
  tiles: { key: string; href: string; x: number; y: number }[];
}

export function tileLayout(f: Frame, width: number, height: number, dpr = 1, maxZoom = 19): TileLayout {
  const cosLat = Math.cos(rad(f.origin.lat));
  const want = Math.log2(EARTH_MPP0 * cosLat * f.scale * Math.min(2, Math.max(1, dpr)));
  const z = Math.max(12, Math.min(maxZoom, Math.round(want)));
  const mpp = (EARTH_MPP0 * cosLat) / 2 ** z;
  const o = mercator(f.origin, z);
  const k = f.scale * mpp;
  const t = rad(f.upDeg);
  const { u: uo, v: vo } = { u: 0, v: 0 }; // origin is (0,0) in u/v
  const e = f.cx + (uo - f.uc) * f.scale;
  const fy = f.cy + (f.vc - vo) * f.scale;
  const matrix = `matrix(${k * Math.cos(t)} ${-k * Math.sin(t)} ${k * Math.sin(t)} ${k * Math.cos(t)} ${e} ${fy})`;
  const corners = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ].map(([x, y]) => mercator(unproject(f, x, y), z));
  const x0 = Math.floor(Math.min(...corners.map((c) => c.x)) / TILE);
  const x1 = Math.floor(Math.max(...corners.map((c) => c.x)) / TILE);
  const y0 = Math.floor(Math.min(...corners.map((c) => c.y)) / TILE);
  const y1 = Math.floor(Math.max(...corners.map((c) => c.y)) / TILE);
  const tiles: TileLayout['tiles'] = [];
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++)
      tiles.push({
        key: `${z}/${tx}/${ty}`,
        href: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`,
        x: tx * TILE - o.x,
        y: ty * TILE - o.y,
      });
  return { z, matrix, tiles, ox: o.x, oy: o.y };
}

/** Tile-pixel position (at zoom z) of a Web Mercator point, for laying images over the tiles. */
export function mercToTilePx(x: number, y: number, z: number) {
  const half = Math.PI * 6378137;
  const n = TILE * 2 ** z;
  return { x: ((x + half) / (2 * half)) * n, y: ((half - y) / (2 * half)) * n };
}
