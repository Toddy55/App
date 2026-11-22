import type { Course, Hole } from '../types';
import { blankHoles, parFromLength } from './courses';

/**
 * Built-in course list (generated from OpenStreetMap by
 * scripts/build-course-catalog.ts), so finding a course needs no internet.
 */
export interface CatalogHole {
  n: number;
  par: number;
  si: number;
  len?: number;
  tee?: [number, number];
  g?: [number, number];
  poly?: [number, number][];
  /** Dogleg points between tee and green. */
  path?: [number, number][];
  /** 1 = par estimated from length; 1 = stroke index missing. */
  pe?: 1;
  se?: 1;
}

export interface CatalogHazard {
  /** b = bunker, w = water, f = fairway */
  k: 'b' | 'w' | 'f' | 't';
  p: [number, number][];
}

export interface CatalogCourse {
  ref: string;
  name: string;
  suburb?: string;
  at: [number, number];
  holes?: CatalogHole[];
  hz?: CatalogHazard[];
}

export interface Catalog {
  v: 1;
  region: string;
  generated: string;
  courses: CatalogCourse[];
}

let cache: Promise<Catalog> | null = null;

/** Loaded on first use and cached by the app for offline use. */
export function loadCatalog(): Promise<Catalog> {
  cache ??= import('../data/seq-courses.json').then((m) => (m.default ?? m) as unknown as Catalog);
  return cache;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\b(golf|club|course|country|the|gc|g\.c\.)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Match as you type: every word you type must start a word in the course name or its suburb. */
export function searchCatalog(cat: Catalog, text: string, limit = 12): CatalogCourse[] {
  const q = norm(text);
  if (!q) return [];
  const words = q.split(' ');
  const scored: { c: CatalogCourse; score: number }[] = [];
  for (const c of cat.courses) {
    const hay = `${norm(c.name)} ${norm(c.suburb ?? '')}`;
    const tokens = hay.split(' ');
    if (!words.every((w) => tokens.some((t) => t.startsWith(w)) || hay.includes(w))) continue;
    const nameHit = norm(c.name).startsWith(words[0]) ? 0 : 1;
    scored.push({ c, score: nameHit * 10 + (c.holes ? 0 : 1) });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name))
    .slice(0, limit)
    .map((s) => s.c);
}

export function catalogToCourse(c: CatalogCourse): Course {
  const P = (p: [number, number]) => ({ lat: p[0], lon: p[1] });
  // Lists built before pars were estimated: a full card of 4s means the map had no pars
  const untagged = !!c.holes && c.holes.length >= 9 && c.holes.every((h) => h.par === 4 && !h.pe);
  const sis = new Set(c.holes?.map((h) => h.si));
  const noSI = !!c.holes && c.holes.every((h) => h.si === h.n);
  const holes: Hole[] = c.holes
    ? c.holes.map((h) => ({
        number: h.n,
        par: untagged ? parFromLength(h.len) : h.par,
        si: h.si,
        ...(h.pe || untagged ? { parEst: true } : {}),
        ...(h.se || noSI || sis.size !== c.holes!.length ? { siEst: true } : {}),
        lengthM: h.len,
        tee: h.tee ? P(h.tee) : undefined,
        green: h.g ? { centre: P(h.g), polygon: h.poly?.map(P) } : undefined,
        path: h.path?.map(P),
      }))
    : blankHoles(18);
  return {
    id: `osm-${c.ref.replace('/', '-')}`,
    name: c.name,
    suburb: c.suburb,
    state: 'QLD',
    location: P(c.at),
    holes,
    hazards: c.hz?.map((z) => ({ kind: z.k === 'b' ? 'bunker' : z.k === 'w' ? 'water' : z.k === 't' ? 'trees' : 'fairway', poly: z.p.map(P) })),
    source: 'osm',
    osmRef: c.ref,
    updatedAt: Date.now(),
  };
}

/**
 * Bring a course saved on this phone up to date from the built-in list:
 * pars and stroke indexes (unless the golfer has checked or edited the
 * scorecard), plus hazards and dogleg lines. Returns null if nothing changed.
 */
export async function refreshCourse(course: Course): Promise<Course | null> {
  if (!course.osmRef) return null;
  const cat = await loadCatalog();
  const entry = cat.courses.find((c) => c.ref === course.osmRef);
  if (!entry) return null;
  const fresh = catalogToCourse(entry);
  let changed = false;
  const holes = course.holes.map((h) => {
    const f = fresh.holes.find((x) => x.number === h.number);
    if (!f) return h;
    const next: Hole = { ...h, path: h.path ?? f.path };
    if (!course.cardEdited && entry.holes) {
      next.par = f.par;
      next.si = f.si;
      next.parEst = f.parEst;
      next.siEst = f.siEst;
      if (!next.parEst) delete next.parEst;
      if (!next.siEst) delete next.siEst;
    }
    if (JSON.stringify(next) !== JSON.stringify(h)) changed = true;
    return next;
  });
  let hazards = course.hazards?.length ? course.hazards : fresh.hazards;
  // Courses saved before trees were mapped: add them now
  if (course.hazards?.length && !course.hazards.some((z) => z.kind === 'trees')) {
    const trees = (fresh.hazards ?? []).filter((z) => z.kind === 'trees');
    if (trees.length) hazards = [...course.hazards, ...trees];
  }
  if (hazards !== course.hazards) changed = true;
  return changed ? { ...course, holes, hazards } : null;
}
