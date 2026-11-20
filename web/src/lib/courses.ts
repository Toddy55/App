import type { Course, Green, Hole, LatLon } from '../types';
import { centroid, distanceM, pathLength, pointInPolygon } from './geo';

/**
 * Course data comes from OpenStreetMap via the Overpass API. OSM has most
 * Australian golf courses mapped, and many with hole-by-hole detail
 * (tee-to-green lines with par and stroke index, plus green outlines).
 * Anything missing can be filled in or corrected in the course editor.
 */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: { lat: number; lon: number }[];
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[];
  tags?: Record<string, string>;
}

async function overpass(query: string): Promise<OsmElement[]> {
  let lastErr: unknown;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) throw new Error(`Course server returned ${res.status}`);
      const json = await res.json();
      return json.elements ?? [];
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Could not reach the course database');
}

export interface CourseHit {
  osmRef: string; // e.g. "way/123"
  name: string;
  location?: LatLon;
  state?: string;
  suburb?: string;
  distanceKm?: number;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&');
}

function toHit(e: OsmElement, from?: LatLon): CourseHit | null {
  const name = e.tags?.name;
  if (!name) return null;
  const c = e.center ?? (e.lat != null ? { lat: e.lat, lon: e.lon! } : undefined);
  return {
    osmRef: `${e.type}/${e.id}`,
    name,
    location: c,
    state: e.tags?.['addr:state'],
    suburb: e.tags?.['addr:suburb'] ?? e.tags?.['addr:city'],
    distanceKm: from && c ? distanceM(from, c) / 1000 : undefined,
  };
}

/** Search golf courses in Australia by name. */
export async function searchCourses(text: string): Promise<CourseHit[]> {
  const q = escapeRegex(text.trim());
  const query = `[out:json][timeout:25];
area["ISO3166-1"="AU"][admin_level=2]->.au;
nwr["leisure"="golf_course"]["name"~"${q}",i](area.au);
out center tags 50;`;
  const els = await overpass(query);
  return els.map((e) => toHit(e)).filter((h): h is CourseHit => !!h);
}

/** Golf courses within radiusKm of a point. */
export async function nearbyCourses(at: LatLon, radiusKm = 25): Promise<CourseHit[]> {
  const query = `[out:json][timeout:25];
nwr["leisure"="golf_course"](around:${Math.round(radiusKm * 1000)},${at.lat},${at.lon});
out center tags 50;`;
  const els = await overpass(query);
  return els
    .map((e) => toHit(e, at))
    .filter((h): h is CourseHit => !!h)
    .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
}

function geom(e: OsmElement): LatLon[] {
  if (e.geometry) return e.geometry.map((g) => ({ lat: g.lat, lon: g.lon }));
  if (e.members) {
    const outer = e.members.find((m) => m.role === 'outer' && m.geometry);
    if (outer?.geometry) return outer.geometry.map((g) => ({ lat: g.lat, lon: g.lon }));
  }
  return [];
}

/** Download hole-by-hole detail for a course and build a Course record. */
export async function loadCourse(hit: CourseHit): Promise<Course> {
  const [type, id] = hit.osmRef.split('/');
  const sel = type === 'relation' ? `rel(${id})` : type === 'way' ? `way(${id})` : `node(${id})`;
  const detail = (scope: string) => `(
  way["golf"="hole"]${scope};
  way["golf"="green"]${scope};
  relation["golf"="green"]${scope};
);
out geom tags;`;
  let els: OsmElement[] = [];
  if (type !== 'node') {
    els = await overpass(`[out:json][timeout:60];
${sel};
map_to_area->.c;
${detail('(area.c)')}`);
  }
  if (!els.some((e) => e.tags?.golf === 'hole') && hit.location) {
    // Course boundary missing or incomplete: look around the course centre.
    els = await overpass(`[out:json][timeout:60];
${detail(`(around:1800,${hit.location.lat},${hit.location.lon})`)}`);
  }
  return buildCourse(hit, els);
}

export function buildCourse(hit: CourseHit, els: OsmElement[]): Course {
  const greens = els
    .filter((e) => e.tags?.golf === 'green')
    .map((e) => geom(e))
    .filter((p) => p.length >= 3)
    .map((polygon) => ({ polygon, centre: centroid(polygon) }));

  const holeWays = els.filter((e) => e.tags?.golf === 'hole' && (e.geometry?.length ?? 0) >= 2);
  const byNumber = new Map<number, Hole>();
  for (const w of holeWays) {
    const num = parseInt(w.tags?.ref ?? '', 10);
    if (!Number.isFinite(num) || num < 1 || num > 27 || byNumber.has(num)) continue;
    const line = geom(w);
    const end = line[line.length - 1];
    let green: Green | undefined = greens.find((g) => pointInPolygon(end, g.polygon));
    if (!green) {
      const near = greens
        .map((g) => ({ g, d: distanceM(end, g.centre) }))
        .sort((a, b) => a.d - b.d)[0];
      green = near && near.d < 60 ? near.g : { centre: end };
    }
    const par = parseInt(w.tags?.par ?? '', 10);
    const si = parseInt(w.tags?.handicap ?? w.tags?.['stroke_index'] ?? '', 10);
    byNumber.set(num, {
      number: num,
      par: Number.isFinite(par) ? par : 4,
      si: Number.isFinite(si) ? si : num,
      lengthM: Math.round(pathLength(line)),
      tee: line[0],
      green,
    });
  }
  let holes = [...byNumber.values()].sort((a, b) => a.number - b.number).filter((h) => h.number <= 18);
  if (holes.length === 0) holes = blankHoles(18);
  else if (holes.length < 18 && holes.length > 9) {
    // fill gaps so the card is complete; user can map the rest
    const have = new Set(holes.map((h) => h.number));
    for (const h of blankHoles(18)) if (!have.has(h.number)) holes.push(h);
    holes.sort((a, b) => a.number - b.number);
  }
  return {
    id: `osm-${hit.osmRef.replace('/', '-')}`,
    name: hit.name,
    state: hit.state,
    suburb: hit.suburb,
    location: hit.location,
    holes,
    source: 'osm',
    osmRef: hit.osmRef,
    updatedAt: Date.now(),
  };
}

export function blankHoles(n: number): Hole[] {
  const pars = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
  return Array.from({ length: n }, (_, i) => ({ number: i + 1, par: pars[i % 18], si: i + 1 }));
}

export function courseCompleteness(c: Course): { mapped: number; total: number; hasSI: boolean } {
  const mapped = c.holes.filter((h) => h.green).length;
  const sis = new Set(c.holes.map((h) => h.si));
  return { mapped, total: c.holes.length, hasSI: sis.size === c.holes.length };
}
