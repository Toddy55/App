import type { Green, LatLon } from '../types';
import { fromLocal, toLocal } from './geo';

/**
 * Ground heights around a green from the Queensland Government's LiDAR
 * elevation model (0.5–1 m resolution over most of South East Queensland).
 * Includes material © State of Queensland, CC BY 4.0.
 *
 * The grid is in Web Mercator (the same as the satellite tiles), row 0 at
 * the north edge, heights in metres.
 */
export interface Dem {
  w: number;
  h: number;
  /** Heights, row-major from the north-west corner. NaN where there's no data. */
  z: Float32Array;
  /** Web Mercator extent (metres). */
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  /** Ground size of one cell, metres. */
  cellM: number;
}

const SERVICE = 'https://spatial-img.information.qld.gov.au/arcgis/rest/services/Elevation/QldDem/ImageServer';
export const DEM_CREDIT = 'Elevation © State of Queensland (CC BY 4.0)';
const R = 6378137;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export const toMerc = (p: LatLon) => ({ x: R * rad(p.lon), y: R * Math.log(Math.tan(Math.PI / 4 + rad(p.lat) / 2)) });
export const fromMerc = (x: number, y: number): LatLon => ({ lat: deg(2 * Math.atan(Math.exp(y / R)) - Math.PI / 2), lon: deg(x / R) });

/** Rough check that a point is in Queensland (the only place this data covers). */
export const inQueensland = (p: LatLon) => p.lat < -9 && p.lat > -29.2 && p.lon > 137.9 && p.lon < 153.7;

/** The area to fetch: the green plus a few metres around it. */
export function greenBox(green: Green, padM = 5): { sw: LatLon; ne: LatLon } {
  const pts = green.polygon?.length ? green.polygon : [green.centre];
  const o = green.centre;
  const loc = pts.map((p) => toLocal(o, p));
  const half = 14; // a green without an outline: assume ~28 m across
  const xs = loc.map((p) => p.x);
  const ys = loc.map((p) => p.y);
  const x0 = Math.min(...xs, green.polygon?.length ? Infinity : -half) - padM;
  const x1 = Math.max(...xs, green.polygon?.length ? -Infinity : half) + padM;
  const y0 = Math.min(...ys, green.polygon?.length ? Infinity : -half) - padM;
  const y1 = Math.max(...ys, green.polygon?.length ? -Infinity : half) + padM;
  return { sw: fromLocal(o, x0, y0), ne: fromLocal(o, x1, y1) };
}

const memo = new Map<string, Promise<Dem | null>>();

/** Heights for a green, cached on the phone so each green is only fetched once. */
export function fetchGreenDem(green: Green): Promise<Dem | null> {
  if (!inQueensland(green.centre)) return Promise.resolve(null);
  const key = `gtg.dem1.${green.centre.lat.toFixed(5)},${green.centre.lon.toFixed(5)}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const p = (async () => {
    const cached = readCache(key);
    if (cached) return cached;
    const { sw, ne } = greenBox(green);
    const a = toMerc(sw);
    const b = toMerc(ne);
    const spanM = Math.max(distanceMerc(a.x, b.x, sw.lat), distanceMerc(a.y, b.y, sw.lat));
    // about 1 m per cell (the data is 0.5–1 m), capped to keep it small
    const n = Math.max(16, Math.min(96, Math.round(spanM)));
    const w = Math.round((n * (b.x - a.x)) / Math.max(b.x - a.x, b.y - a.y));
    const h = Math.round((n * (b.y - a.y)) / Math.max(b.x - a.x, b.y - a.y));
    const url =
      `${SERVICE}/exportImage?bbox=${a.x},${a.y},${b.x},${b.y}&bboxSR=3857&imageSR=3857&size=${w},${h}` +
      `&format=bsq&pixelType=F32&noData=-9999&interpolation=RSP_BilinearInterpolation&f=image`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Elevation service: HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength < w * h * 4) throw new Error('Elevation service sent too little data');
    // Little-endian float32, row by row from the top; anything after w*h is padding
    const view = new DataView(buf);
    const z = new Float32Array(w * h);
    let good = 0;
    for (let i = 0; i < w * h; i++) {
      const v = view.getFloat32(i * 4, true);
      z[i] = v > -1000 && v < 9000 ? v : NaN;
      if (!Number.isNaN(z[i])) good++;
    }
    if (good < w * h * 0.5) return null; // not covered here
    const dem: Dem = { w, h, z, xmin: a.x, xmax: b.x, ymin: a.y, ymax: b.y, cellM: ((b.x - a.x) / w) * Math.cos(rad(green.centre.lat)) };
    writeCache(key, dem);
    return dem;
  })().catch((e) => {
    memo.delete(key);
    throw e;
  });
  memo.set(key, p);
  return p;
}

function distanceMerc(a: number, b: number, lat: number) {
  return Math.abs(b - a) * Math.cos(rad(lat));
}

function readCache(key: string): Dem | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const o = JSON.parse(raw) as Omit<Dem, 'z'> & { z: string };
    const bytes = Uint8Array.from(atob(o.z), (c) => c.charCodeAt(0));
    return { ...o, z: new Float32Array(bytes.buffer) };
  } catch {
    return null;
  }
}

function writeCache(key: string, dem: Dem) {
  try {
    const bytes = new Uint8Array(dem.z.buffer.slice(0));
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    localStorage.setItem(key, JSON.stringify({ ...dem, z: btoa(s) }));
  } catch {
    /* storage full: it'll just be fetched again next time */
  }
}
