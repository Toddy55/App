import type { Course, TeeSet } from '../types';
import { TEE_COLOURS } from './tees';

/**
 * The club's real tees for courses in the built-in list (from GolfCourseAPI,
 * see scripts/fetch-course-tees.ts): name, ratings, and every hole's length
 * and par off the scorecard. Added to saved courses that have no tees entered.
 */
export interface ClubTee {
  /** Tee name as the club calls it, e.g. "Blue". */
  n: string;
  /** Men's or women's ratings. */
  g: 'm' | 'f';
  /** Scratch (course) rating and slope. */
  cr?: number;
  sr?: number;
  /** Hole by hole, from hole 1: metres, par, stroke index. */
  len: number[];
  par: number[];
  si?: number[];
}
export interface CourseTees {
  /** GolfCourseAPI course id and name (for checking the match). */
  id: string;
  name: string;
  tees: ClubTee[];
}
export interface TeesFile {
  v: 1;
  generated: string;
  /** By course list ref (e.g. "way/123"). */
  courses: Record<string, CourseTees>;
  /** Looked up and not found (so they're not asked for again every run). */
  missed?: Record<string, string>;
}

let cache: Promise<TeesFile> | null = null;
export function loadClubTees(): Promise<TeesFile> {
  cache ??= import('../data/course-tees.json').then((m) => (m.default ?? m) as unknown as TeesFile);
  return cache;
}

const COLOUR_WORDS: Record<string, string> = {
  ...Object.fromEntries(TEE_COLOURS.map((c) => [c.name.toLowerCase(), c.colour])),
  grey: '#9ca3af',
  gray: '#9ca3af',
  silver: '#cbd5e1',
  bronze: '#b45309',
  orange: '#f97316',
  purple: '#9333ea',
  khaki: '#a3a375',
  brown: '#78350f',
  maroon: '#7f1d1d',
  championship: '#111827',
};
/** A marker colour from the tee's name ("Blue", "Blue/White" → blue). */
export function colourFor(name: string): string | undefined {
  const w = name.toLowerCase().match(/[a-z]+/g) ?? [];
  for (const x of w) if (COLOUR_WORDS[x]) return COLOUR_WORDS[x];
  return undefined;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The club's tees as the app's tee sets: men's first (longest first), then women's. */
export function toTeeSets(ct: CourseTees, holeNumbers: number[]): TeeSet[] {
  const total = (t: ClubTee) => t.len.reduce((s, x) => s + x, 0);
  const sorted = [...ct.tees].sort((a, b) => (a.g === b.g ? total(b) - total(a) : a.g === 'm' ? -1 : 1));
  const seen = new Set<string>();
  const out: TeeSet[] = [];
  for (const t of sorted) {
    // Women's ratings (and sometimes pars) differ off the same tee, so say which is which
    const name = t.g === 'f' && !/wom|lad/i.test(t.n) ? `${t.n} (women)` : t.n;
    let id = `club-${t.g}-${slug(t.n)}`;
    for (let k = 2; seen.has(id); k++) id = `club-${t.g}-${slug(t.n)}-${k}`;
    seen.add(id);
    const lengths: Record<number, number> = {};
    const pars: Record<number, number> = {};
    holeNumbers.forEach((n, i) => {
      if (t.len[i]) lengths[n] = t.len[i];
      if (t.par[i]) pars[n] = t.par[i];
    });
    out.push({
      id,
      name,
      colour: colourFor(t.n),
      lengths,
      pars,
      ...(t.cr ? { scratchRating: t.cr } : {}),
      ...(t.sr ? { slopeRating: t.sr } : {}),
      women: t.g === 'f' || undefined,
      club: true,
    });
  }
  return out;
}

/**
 * Add the club's tees to a saved course (if it has none entered, or only the
 * club's from an earlier list). Returns null if there's nothing to change.
 */
export async function withClubTees(course: Course): Promise<Course | null> {
  if (!course.osmRef) return null;
  if (course.tees?.some((t) => !t.club)) return null; // entered by hand: leave them
  let file: TeesFile;
  try {
    file = await loadClubTees();
  } catch {
    return null;
  }
  const ct = file.courses[course.osmRef];
  if (!ct) return null;
  const tees = toTeeSets(ct, course.holes.map((h) => h.number));
  if (!tees.length) return null;
  // Pars the map had to guess: the club's scorecard (men's tees) knows
  const card = tees.find((t) => !t.women) ?? tees[0];
  const holes = course.cardEdited
    ? course.holes
    : course.holes.map((h) => {
        const par = card.pars?.[h.number];
        if (!h.parEst || !par) return h;
        const { parEst: _e, ...rest } = h;
        return { ...rest, par };
      });
  const next = { ...course, holes, tees };
  return JSON.stringify(next) === JSON.stringify(course) ? null : next;
}
