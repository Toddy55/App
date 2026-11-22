/**
 * Club tees for every course in the built-in list, from GolfCourseAPI
 * (golfcourseapi.com): each tee's name, scratch and slope rating, and every
 * hole's length and par off the scorecard. Saved to src/data/course-tees.json,
 * which the app adds to courses that don't have their tees entered by hand.
 *
 * Run: GOLFCOURSEAPI_KEY=... npx tsx scripts/fetch-course-tees.ts [--all] [--retry-missed] [--from=<live course-tees.json url>] [--plan]
 * Courses already matched are kept (only new ones are looked up) unless --all.
 * The API only takes a few requests a minute, so it goes slowly; if it's still
 * refused after a few waits, whatever's left is picked up next run.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Catalog } from '../src/lib/courseCatalog';
import { likeness, sameCourse, words, type ClubTee, type CourseTees, type ExtraCourse, type LinkCourse, type TeesFile } from '../src/lib/clubTees';
import { distanceM } from '../src/lib/geo';

const API = 'https://api.golfcourseapi.com/v1';
const KEY = process.env.GOLFCOURSEAPI_KEY;
if (!KEY) {
  console.error('Set GOLFCOURSEAPI_KEY first.');
  process.exit(1);
}
const OUT = new URL('../src/data/course-tees.json', import.meta.url);
const LINKS = new URL('../src/data/scorecard-links.json', import.meta.url);
const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
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
  location?: { latitude?: number; longitude?: number; state?: string; city?: string };
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
      prev.extra = { ...live.extra, ...prev.extra };
      for (const ref of Object.keys(prev.courses)) delete prev.missed[ref];
      console.log(`Carrying on from the live list: ${Object.keys(live.courses ?? {}).length} courses with tees.`);
    } catch {
      console.log('No live list of tees yet: starting from the saved one.');
    }
  }
  const courses: Record<string, CourseTees> = { ...prev.courses };
  const missed: Record<string, string> = { ...(prev.missed ?? {}) };
  const skip = /driving range|mini golf|putt putt|par 3|pitch and putt|pitch & putt|golf range|practice|pro shop/i;
  const extra: Record<string, ExtraCourse> = { ...(prev.extra ?? {}) };

  // The SEQ course list (src/data/scorecard-links.json): these go first, and the ones
  // OpenStreetMap doesn't have (Royal Queensland, Indooroopilly…) are added from the API
  const links = (JSON.parse(readFileSync(LINKS, 'utf8')) as { courses: LinkCourse[] }).courses.filter((l) => !skip.test(l.name) && !/par 3/i.test(l.note ?? ''));
  const listed = (c: { name: string; suburb?: string }) => links.find((l) => sameCourse(l, c));
  const extras = links.filter((l) => !cat.courses.some((c) => sameCourse(l, c)));
  type Job = { kind: 'map'; c: Catalog['courses'][number] } | { kind: 'extra'; l: LinkCourse };
  const jobs: Job[] = [
    ...cat.courses.filter((c) => listed(c)).map((c) => ({ kind: 'map' as const, c })),
    ...extras.map((l) => ({ kind: 'extra' as const, l })),
    ...cat.courses.filter((c) => !listed(c)).map((c) => ({ kind: 'map' as const, c })),
  ];
  if (process.argv.includes('--plan')) {
    // Just show the order courses would be looked up in
    for (const j of jobs) {
      const ref = j.kind === 'map' ? j.c.ref : `list/${j.l.id}`;
      const name = j.kind === 'map' ? j.c.name : j.l.name;
      if (!skip.test(name) && !courses[ref] && !missed[ref]) console.log(j.kind === 'map' ? '  map ' : '  new ', name);
    }
    return;
  }
  let found = 0;
  try {
    for (const job of jobs) {
      const ref = job.kind === 'map' ? job.c.ref : `list/${job.l.id}`;
      const name = job.kind === 'map' ? job.c.name : job.l.name;
      if (skip.test(name)) continue;
      if (!ALL && (courses[ref] || (missed[ref] && (!RETRY || missed[ref].includes('on the map as'))))) continue;
      const at = job.kind === 'map' ? { lat: job.c.at[0], lon: job.c.at[1] } : null;
      // "Keperra Country GC – North": the club, then which course
      const w = words(name);
      // The whole name first, then its longest word ("Coolangatta & Tweed Heads" → "coolangatta")
      const queries = [w.join(' ') || name, ...(w.length > 1 ? [[...w].sort((a, b) => b.length - a.length)[0]] : [])];
      const near = (r: ApiCourse) =>
        at ? r.location?.latitude != null && distanceM(at, { lat: r.location.latitude, lon: r.location.longitude! }) < 4000 : /^(qld|queensland)$/i.test(r.location?.state ?? '');
      let hits: ApiCourse[] = [];
      for (const q of queries) {
        const res = await get<{ courses?: ApiCourse[] }>(`/search?search_query=${encodeURIComponent(q)}`);
        hits = (res.courses ?? []).filter(near);
        if (hits.length) break;
      }
      // Must be this course: a similar name (and close by, for mapped ones), or the only course right there
      const ranked = hits
        .map((r) => ({
          r,
          d: at && r.location?.latitude != null ? distanceM(at, { lat: r.location.latitude, lon: r.location.longitude! }) : Infinity,
          like: Math.max(likeness(name, r.course_name), likeness(name, r.club_name), likeness(name, `${r.club_name} ${r.course_name}`)),
          // Which course at a multi-course club: "East" must be in its name
          which: name.includes('–') ? likeness(name.split('–')[1], r.course_name) : 0,
        }))
        .filter((x) => x.like >= 0.5 || (at && hits.length === 1 && x.d < 1500))
        .sort((a, b) => b.which - a.which || b.like - a.like || a.d - b.d);
      if (!ranked.length) {
        missed[ref] = name;
        console.log(`  – ${name}: no match`);
        continue;
      }
      const best = ranked[0].r;
      const full = await get<{ course?: ApiCourse } & ApiCourse>(`/courses/${best.id}`);
      const detail = full.course ?? full;
      const tees = toTees(detail, job.kind === 'map' ? job.c.holes?.length : undefined);
      if (!tees.length) {
        missed[ref] = name;
        console.log(`  – ${name}: matched ${best.course_name} but no hole lengths`);
        continue;
      }
      let key = ref;
      if (job.kind === 'extra' && detail.location?.latitude != null) {
        const at2 = { lat: detail.location.latitude, lon: detail.location.longitude! };
        // On the map after all, under another name ("Palms Course" for Sanctuary Cove – The Palms): use that
        const mapped = cat.courses.find((c) => distanceM(at2, { lat: c.at[0], lon: c.at[1] }) < 1500 && likeness(job.l.name, c.name) > 0 && !skip.test(c.name));
        if (mapped) {
          // Remembered as done either way, so it isn't looked up again
          missed[ref] = `${name} (on the map as ${mapped.name})`;
          if (courses[mapped.ref]) continue;
          key = mapped.ref;
        } else extra[ref] = { name: job.l.name, suburb: job.l.suburb, at: [r5(at2.lat), r5(at2.lon)] };
      }
      courses[key] = { id: String(best.id), name: best.course_name, tees };
      if (key === ref) delete missed[ref];
      found++;
      console.log(`  ✓ ${name}${job.kind === 'extra' ? ' (new course)' : ''} → ${best.course_name}: ${tees.map((t) => t.n + (t.g === 'f' ? ' (W)' : '')).join(', ')}`);
    }
  } catch (e) {
    if (e instanceof Error && e.message === 'LIMIT') console.warn("Hit the API's daily limit: the rest will be looked up next run.");
    else throw e;
  } finally {
    const file: TeesFile = { v: 1, generated: new Date().toISOString(), courses, missed, extra };
    writeFileSync(OUT, JSON.stringify(file) + '\n');
    console.log(`${found} new, ${Object.keys(courses).length} courses with tees, ${Object.keys(missed).length} not found, ${calls} requests.`);
  }
}

main();
