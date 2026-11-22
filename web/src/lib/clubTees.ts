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
/** A course from Toddy's SEQ list (src/data/scorecard-links.json). */
export interface LinkCourse {
  id: string;
  name: string;
  region: string;
  suburb: string;
  /** A page showing the club's scorecard (Hole19, GolfPass…), when one was found. */
  url?: string;
  site?: string;
  note?: string;
}
/** A course OpenStreetMap doesn't have, added from the list with the API's location. */
export interface ExtraCourse {
  name: string;
  suburb?: string;
  at: [number, number];
}
export interface TeesFile {
  v: 1;
  generated: string;
  /** By course list ref (e.g. "way/123"). */
  courses: Record<string, CourseTees>;
  /** Looked up and not found (so they're not asked for again every run). */
  missed?: Record<string, string>;
  /** Courses added from the SEQ list (ref "list/<id>"): their tees are in `courses` too. */
  extra?: Record<string, ExtraCourse>;
}

const STOP = new Set(['golf', 'club', 'course', 'country', 'the', 'gc', 'inc', 'and', 'resort', 'links', 'qld', 'spa', 'international']);
export const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));

/** Words in common between two names, as a share of the shorter. */
export function likeness(a: string, b: string): number {
  const x = new Set(words(a));
  const y = new Set(words(b));
  if (!x.size || !y.size) return 0;
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return n / Math.min(x.size, y.size);
}

const sameSuburb = (a?: string, b?: string) => !!a && !!b && words(a).join(' ') === words(b).join(' ');
/** Words lots of course names share: on their own they don't make two names the same course. */
const COMMON = new Set(
  'lakes lake park river north south east west mount mt island islands springs waters water gold coast heads valley greens hills hill palms pines royal city bay creek beach harbour sunshine brisbane queensland national village glades grand old new'.split(' '),
);

/** Every word of the shorter name is in the longer one, and at least one of them isn't a common word. */
function sameName(a: string, b: string): 'yes' | 'common' | 'no' {
  const x = words(a);
  const y = words(b);
  if (!x.length || !y.length) return 'no';
  const [short, long] = x.length <= y.length ? [x, new Set(y)] : [y, new Set(x)];
  if (!short.every((w) => long.has(w))) return 'no';
  return short.some((w) => !COMMON.has(w)) ? 'yes' : 'common';
}

/**
 * Is this list entry that course? "Keperra Country GC – Old" is Keperra Golf
 * Course; "Sanctuary Cove – The Palms" is the map's "Palms Course" if the suburb
 * agrees. "Gold Coast Country Club" is not Gold Coast Burleigh.
 */
export function sameCourse(l: { name: string; suburb?: string }, c: { name: string; suburb?: string }): boolean {
  const club = l.name.split('–')[0];
  const verdicts = [sameName(club, c.name), sameName(l.name, c.name)];
  if (verdicts.includes('yes')) return true;
  return verdicts.includes('common') && sameSuburb(l.suburb, c.suburb);
}

let linksCache: Promise<LinkCourse[]> | null = null;
/** Share of words two names have in common (of all the words in either). */
function overlap(a: string, b: string): number {
  const x = new Set(words(a));
  const y = new Set(words(b));
  const both = [...x].filter((w) => y.has(w)).length;
  return both / (new Set([...x, ...y]).size || 1);
}

/** The club's scorecard pages for a course (more than one at a 27/36-hole club). Closest name wins: "Noosa GC" for Noosa Golf Club, not Noosa Springs. */
export async function scorecardLinks(course: { name: string; suburb?: string }): Promise<LinkCourse[]> {
  linksCache ??= import('../data/scorecard-links.json').then((m) => ((m.default ?? m) as unknown as { courses: LinkCourse[] }).courses);
  const all = (await linksCache).filter((l) => sameCourse(l, course));
  const score = (l: LinkCourse) => Math.max(overlap(l.name, course.name), overlap(l.name.split('–')[0], course.name));
  const best = Math.max(0, ...all.map(score));
  // The closest course first; then only if it has a scorecard page
  return all.filter((l) => score(l) === best && l.url);
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
 * Add the club's tees to a saved course. Tees entered by hand with real numbers
 * are kept (and win over a club tee of the same name); empty ones are replaced.
 * Returns null if there's nothing to change.
 */
export async function withClubTees(course: Course): Promise<Course | null> {
  if (!course.osmRef) return null;
  let file: TeesFile;
  try {
    file = await loadClubTees();
  } catch {
    return null;
  }
  const ct = file.courses[course.osmRef];
  if (!ct) return null;
  const club = toTeeSets(ct, course.holes.map((h) => h.number));
  if (!club.length) return null;
  // Tees added by hand stay if they hold anything (a length or a rating) and come first;
  // an empty one (e.g. "White" tapped in to try it out) gives way to the club's
  const hand = (course.tees ?? []).filter((t) => !t.club && (t.slopeRating || t.scratchRating || Object.keys(t.lengths ?? {}).length));
  const named = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const tees = [...hand, ...club.filter((c) => !hand.some((h) => named(h.name, c.name)))];
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
