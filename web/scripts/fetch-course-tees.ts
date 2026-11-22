/**
 * Club tees for every course in the built-in list, from GolfCourseAPI
 * (golfcourseapi.com): each tee's name, scratch and slope rating, and every
 * hole's length and par off the scorecard. Saved to src/data/course-tees.json,
 * which the app adds to courses that don't have their tees entered by hand.
 *
 * Run: GOLFCOURSEAPI_KEY=... npx tsx scripts/fetch-course-tees.ts [--all] [--retry-missed] [--from=<live course-tees.json url>]
 * Courses already matched are kept (only new ones are looked up) unless --all.
 * The API only takes a few requests a minute, so it goes slowly; if it's still
 * refused after a few waits, whatever's left is picked up next run.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Catalog } from '../src/lib/courseCatalog';
import type { ClubTee, CourseTees, TeesFile } from '../src/lib/clubTees';
import { distanceM } from '../src/lib/geo';

const API = 'https://api.golfcourseapi.com/v1';
const KEY = process.env.GOLFCOURSEAPI_KEY;
if (!KEY) {
  console.error('Set GOLFCOURSEAPI_KEY first.');
  process.exit(1);
}
const OUT = new URL('../src/data/course-tees.json', import.meta.url);
const CATALOG = process.argv.find((a) => a.endsWith('.json')) ?? new URL('../src/data/seq-courses.json', import.meta.url).pathname;
const ALL = process.argv.includes('--all');
/** The live app's copy (built by earlier nightly runs), to carry on from where they got to. */
const LIVE = process.argv.find((a) => a.startsWith('--from='))?.slice(7);
/** Have another go at the ones not found last time. */
const RETRY = process.argv.includes('--retry-missed');

interface ApiHole {
  par?: number;
  yardage?: number;
  meters?: number;
  handicap?: number;
}
interface ApiTee {
  tee_name: string;
  course_rating?: number;
  slope_rating?: number;
  total_meters?: number;
  number_of_holes?: number;
  holes?: ApiHole[];
}
interface ApiCourse {
  id: string | number;
  club_name: string;
  course_name: string;
  location?: { latitude?: number; longitude?: number };
  tees?: { male?: ApiTee[]; female?: ApiTee[] };
}

let calls = 0;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** One request, gently: a pause between each, and a wait-and-retry when the API says slow down. */
async function get<T>(path: string): Promise<T> {
  for (let tries = 0; ; tries++) {
    await wait(2500);
    calls++;
    const res = await fetch(API + path, { headers: { Authorization: `Key ${KEY}` } });
    if (res.status === 429) {
      // Out for the day: stop now and save what we have
      const why = await res.text().catch(() => '');
      if (/daily/i.test(why) || tries >= 4) throw new Error('LIMIT');
      console.log('  (slowing down for the API…)');
      await wait(30000 * (tries + 1));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
    return (await res.json()) as T;
  }
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !['golf', 'club', 'course', 'country', 'the', 'gc', 'inc', 'and', 'resort', 'links', 'qld'].includes(w));

/** Words in common between two names, as a share of the shorter. */
function likeness(a: string, b: string): number {
  const x = new Set(words(a));
  const y = new Set(words(b));
  if (!x.size || !y.size) return 0;
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return n / Math.min(x.size, y.size);
}

function toTees(c: ApiCourse, holesWanted: number | undefined): ClubTee[] {
  const out: ClubTee[] = [];
  for (const [g, list] of [['m', c.tees?.male ?? []], ['f', c.tees?.female ?? []]] as const) {
    for (const t of list) {
      const holes = t.holes ?? [];
      if (!holes.length) continue;
      if (holesWanted && holes.length !== holesWanted) continue;
      const len = holes.map((h) => h.meters ?? (h.yardage ? Math.round(h.yardage * 0.9144) : 0));
      if (len.every((l) => !l)) continue;
      out.push({
        n: t.tee_name.trim(),
        g,
        ...(t.course_rating ? { cr: t.course_rating } : {}),
        ...(t.slope_rating ? { sr: t.slope_rating } : {}),
        len,
        par: holes.map((h) => h.par ?? 0),
        ...(holes.some((h) => h.handicap) ? { si: holes.map((h) => h.handicap ?? 0) } : {}),
      });
    }
  }
  return out;
}

async function main() {
  const cat = JSON.parse(readFileSync(CATALOG, 'utf8')) as Catalog;
  const prev: TeesFile = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { v: 1, generated: '', courses: {}, missed: {} };
  if (LIVE) {
    try {
      const live = (await (await fetch(LIVE)).json()) as TeesFile;
      prev.courses = { ...live.courses, ...prev.courses };
      prev.missed = { ...live.missed, ...prev.missed };
      for (const ref of Object.keys(prev.courses)) delete prev.missed[ref];
      console.log(`Carrying on from the live list: ${Object.keys(live.courses ?? {}).length} courses with tees.`);
    } catch {
      console.log('No live list of tees yet: starting from the saved one.');
    }
  }
  const courses: Record<string, CourseTees> = { ...prev.courses };
  const missed: Record<string, string> = { ...(prev.missed ?? {}) };
  const skip = /driving range|mini golf|putt putt|par 3|pitch and putt|golf range|practice/i;
  let found = 0;
  try {
    for (const c of cat.courses) {
      if (skip.test(c.name)) continue;
      if (!ALL && (courses[c.ref] || (missed[c.ref] && !RETRY))) continue;
      const at = { lat: c.at[0], lon: c.at[1] };
      const w = words(c.name);
      // The whole name first, then its longest word ("Coolangatta & Tweed Heads" → "coolangatta")
      const queries = [w.join(' ') || c.name, ...(w.length > 1 ? [[...w].sort((a, b) => b.length - a.length)[0]] : [])];
      let hits: ApiCourse[] = [];
      for (const q of queries) {
        const res = await get<{ courses?: ApiCourse[] }>(`/search?search_query=${encodeURIComponent(q)}`);
        hits = (res.courses ?? []).filter((r) => r.location?.latitude != null && distanceM(at, { lat: r.location.latitude, lon: r.location.longitude! }) < 4000);
        if (hits.length) break;
      }
      // Must be this course: close by (the map's middle vs the clubhouse address) and a similar name
      const near = hits
        .map((r) => ({
          r,
          d: r.location?.latitude != null ? distanceM(at, { lat: r.location.latitude, lon: r.location.longitude! }) : Infinity,
          like: Math.max(likeness(c.name, r.course_name), likeness(c.name, r.club_name)),
        }))
        // A similar name, or the only course right there
        .filter((x) => x.like >= 0.5 || (hits.length === 1 && x.d < 1500))
        .sort((a, b) => b.like - a.like || a.d - b.d);
      if (!near.length) {
        missed[c.ref] = c.name;
        console.log(`  – ${c.name}: no match`);
        continue;
      }
      const best = near[0].r;
      const full = await get<{ course?: ApiCourse } & ApiCourse>(`/courses/${best.id}`);
      const detail = full.course ?? full;
      const tees = toTees(detail, c.holes?.length);
      if (!tees.length) {
        missed[c.ref] = c.name;
        console.log(`  – ${c.name}: matched ${best.course_name} but no hole lengths`);
        continue;
      }
      courses[c.ref] = { id: String(best.id), name: best.course_name, tees };
      delete missed[c.ref];
      found++;
      console.log(`  ✓ ${c.name} → ${best.course_name}: ${tees.map((t) => t.n + (t.g === 'f' ? ' (W)' : '')).join(', ')}`);
    }
  } catch (e) {
    if (e instanceof Error && e.message === 'LIMIT') console.warn('Hit the API's daily limit: the rest will be looked up next run.');
    else throw e;
  } finally {
    const file: TeesFile = { v: 1, generated: new Date().toISOString(), courses, missed };
    writeFileSync(OUT, JSON.stringify(file) + '\n');
    console.log(`${found} new, ${Object.keys(courses).length} courses with tees, ${Object.keys(missed).length} not found, ${calls} requests.`);
  }
}

main();
