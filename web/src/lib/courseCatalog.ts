import type { Course, Hole } from '../types';
import { blankHoles } from './courses';

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
}

export interface CatalogCourse {
  ref: string;
  name: string;
  suburb?: string;
  at: [number, number];
  holes?: CatalogHole[];
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
  const holes: Hole[] = c.holes
    ? c.holes.map((h) => ({
        number: h.n,
        par: h.par,
        si: h.si,
        lengthM: h.len,
        tee: h.tee ? P(h.tee) : undefined,
        green: h.g ? { centre: P(h.g), polygon: h.poly?.map(P) } : undefined,
      }))
    : blankHoles(18);
  return {
    id: `osm-${c.ref.replace('/', '-')}`,
    name: c.name,
    suburb: c.suburb,
    state: 'QLD',
    location: P(c.at),
    holes,
    source: 'osm',
    osmRef: c.ref,
    updatedAt: Date.now(),
  };
}
