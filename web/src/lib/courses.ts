import type { Course, Green, Hazard, HazardKind, Hole, LatLon } from '../types';
import { centroid, distanceM, pathLength, pointInPolygon } from './geo';

/**
 * Course data comes from OpenStreetMap. Name and town searches use Nominatim
 * (OpenStreetMap's search engine, fast); nearby searches and hole-by-hole
 * detail use the Overpass API (tee-to-green lines with par and stroke index,
 * plus green outlines). The public servers are free and sometimes busy, so
 * every request has a time limit and falls back to another server.
 * Anything missing can be filled in or corrected in the course editor.
 */
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: { lat: number; lon: number }[];
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[];
  tags?: Record<string, string>;
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 15000): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } catch (e) {
    if (ctl.signal.aborted) throw new Error('The course server took too long to answer');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function overpass(query: string, ms = 15000): Promise<OsmElement[]> {
  let lastErr: unknown;
  for (const url of OVERPASS) {
    try {
      const res = await fetchWithTimeout(
        url,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query) },
        ms,
      );
      if (!res.ok) throw new Error(`Course server returned ${res.status}`);
      const json = await res.json();
      return json.elements ?? [];
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    `Couldn't reach the course database right now (${lastErr instanceof Error ? lastErr.message : 'no answer'}). Check your signal and try again in a minute.`,
  );
}

export interface CourseHit {
  osmRef: string; // e.g. "way/123"
  name: string;
  location?: LatLon;
  state?: string;
  suburb?: string;
  distanceKm?: number;
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

interface NominatimResult {
  osm_type: 'node' | 'way' | 'relation';
  osm_id: number;
  lat: string;
  lon: string;
  name?: string;
  category?: string;
  class?: string;
  type?: string;
  display_name: string;
  address?: Record<string, string>;
}

async function nominatim(q: string): Promise<NominatimResult[]> {
  const url = `${NOMINATIM}?format=jsonv2&countrycodes=au&addressdetails=1&limit=20&q=${encodeURIComponent(q)}`;
  const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 12000);
  if (!res.ok) throw new Error(`Search server returned ${res.status}`);
  return res.json();
}

const isGolf = (r: NominatimResult) => (r.category ?? r.class) === 'leisure' && r.type === 'golf_course';

export function nominatimToHit(r: NominatimResult): CourseHit {
  const a = r.address ?? {};
  return {
    osmRef: `${r.osm_type}/${r.osm_id}`,
    name: r.name || r.display_name.split(',')[0],
    location: { lat: Number(r.lat), lon: Number(r.lon) },
    state: a.state,
    suburb: a.suburb ?? a.town ?? a.city ?? a.village,
  };
}

/**
 * Search by course name or by town. "Royal Melbourne" finds the course;
 * "Nambour" finds the town and lists the golf courses around it.
 */
export async function searchCourses(text: string): Promise<CourseHit[]> {
  const q = text.trim();
  const out = new Map<string, CourseHit>();
  let place: LatLon | undefined;
  let searchErr: unknown;
  try {
    const [golf, plain] = await Promise.all([nominatim(/golf/i.test(q) ? q : `${q} golf`), nominatim(q)]);
    for (const r of [...golf, ...plain]) if (isGolf(r)) out.set(`${r.osm_type}/${r.osm_id}`, nominatimToHit(r));
    const town = plain.find((r) => !isGolf(r));
    if (town) place = { lat: Number(town.lat), lon: Number(town.lon) };
  } catch (e) {
    searchErr = e;
  }
  if (place) {
    try {
      for (const h of await nearbyCourses(place, 20)) if (!out.has(h.osmRef)) out.set(h.osmRef, h);
    } catch (e) {
      if (out.size === 0) throw e;
    }
  }
  if (out.size === 0 && searchErr) {
    // Search engine down: fall back to a name match in the course database
    const esc = q.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&');
    const els = await overpass(`[out:json][timeout:25];
area["ISO3166-1"="AU"][admin_level=2]->.au;
nwr["leisure"="golf_course"]["name"~"${esc}",i](area.au);
out center tags 50;`, 30000);
    for (const e of els) {
      const h = toHit(e);
      if (h) out.set(h.osmRef, h);
    }
  }
  return [...out.values()];
}

/** Golf courses within radiusKm of a point. */
export async function nearbyCourses(at: LatLon, radiusKm = 25): Promise<CourseHit[]> {
  const query = `[out:json][timeout:20];
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
  way["golf"~"^(bunker|fairway|water_hazard|lateral_water_hazard)$"]${scope};
  way["natural"="water"]${scope};
);
out geom tags;`;
  let els: OsmElement[] = [];
  if (type !== 'node') {
    els = await overpass(`[out:json][timeout:60];
${sel};
map_to_area->.c;
${detail('(area.c)')}`, 45000);
  }
  if (!els.some((e) => e.tags?.golf === 'hole') && hit.location) {
    // Course boundary missing or incomplete: look around the course centre.
    els = await overpass(`[out:json][timeout:60];
${detail(`(around:1800,${hit.location.lat},${hit.location.lon})`)}`, 45000);
  }
  return buildCourse(hit, els);
}

/** Keep at most n points of a polygon (plenty for course-management maths, and keeps the data small). */
export function thin(poly: LatLon[], n = 16): LatLon[] {
  if (poly.length <= n) return poly;
  const step = poly.length / n;
  return Array.from({ length: n }, (_, i) => poly[Math.floor(i * step)]);
}

function hazardKind(e: OsmElement): HazardKind | null {
  const g = e.tags?.golf;
  if (g === 'bunker') return 'bunker';
  if (g === 'fairway') return 'fairway';
  if (g === 'water_hazard' || g === 'lateral_water_hazard' || e.tags?.natural === 'water') return 'water';
  return null;
}

export function buildHazards(els: OsmElement[]): Hazard[] {
  const out: Hazard[] = [];
  for (const e of els) {
    const kind = hazardKind(e);
    if (!kind) continue;
    const poly = geom(e);
    if (poly.length >= 3) out.push({ kind, poly: thin(poly, kind === 'water' ? 24 : 16) });
  }
  return out;
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
    const par = parseInt(w.tags?.par ?? w.tags?.['golf:par'] ?? '', 10);
    const si = parseInt(w.tags?.handicap ?? w.tags?.['stroke_index'] ?? w.tags?.['golf:handicap'] ?? '', 10);
    const lengthM = Math.round(pathLength(line));
    const hasPar = Number.isFinite(par) && par >= 3 && par <= 6;
    const hasSI = Number.isFinite(si) && si >= 1 && si <= 18;
    byNumber.set(num, {
      number: num,
      par: hasPar ? par : parFromLength(lengthM),
      si: hasSI ? si : num,
      ...(hasPar ? {} : { parEst: true }),
      ...(hasSI ? {} : { siEst: true }),
      lengthM,
      tee: line[0],
      green,
      path: line.length > 2 ? thin(line, 6) : undefined,
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
    hazards: buildHazards(els),
    source: 'osm',
    osmRef: hit.osmRef,
    updatedAt: Date.now(),
  };
}

/**
 * Par from a hole's tee-to-green length when the map has no par: under 230 m
 * a par 3, over 430 m a par 5, otherwise a par 4. Right on about 93% of SEQ
 * holes that do have a par; flagged so the golfer checks it.
 */
export function parFromLength(m: number | undefined): number {
  if (!m) return 4;
  return m < 230 ? 3 : m > 430 ? 5 : 4;
}

export function blankHoles(n: number): Hole[] {
  const pars = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
  return Array.from({ length: n }, (_, i) => ({ number: i + 1, par: pars[i % 18], si: i + 1, parEst: true, siEst: true }));
}

export function courseCompleteness(c: Course): { mapped: number; total: number; hasSI: boolean } {
  const mapped = c.holes.filter((h) => h.green).length;
  const sis = new Set(c.holes.map((h) => h.si));
  return { mapped, total: c.holes.length, hasSI: sis.size === c.holes.length };
}
