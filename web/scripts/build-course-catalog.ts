/**
 * Builds the offline course catalogue (src/data/seq-courses.json) from
 * OpenStreetMap: every named golf course in South East Queensland, with
 * hole-by-hole detail (par, stroke index, tee, green outline) where it's mapped.
 *
 * Run: npx tsx scripts/build-course-catalog.ts
 * (GitHub Actions runs this monthly; see .github/workflows/update-courses.yml)
 */
import { writeFileSync } from 'node:fs';
import { buildCourse, type OsmElement } from '../src/lib/courses';
import { distanceM, pointInPolygon } from '../src/lib/geo';
import type { LatLon } from '../src/types';
import type { Catalog, CatalogCourse } from '../src/lib/courseCatalog';

// South East Queensland: Noosa to the NSW border, Toowoomba to the coast
const BBOX = { south: -28.4, west: 151.8, north: -25.9, east: 153.65 };
const B = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];

async function overpass(query: string): Promise<OsmElement[]> {
  for (const url of ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'fairway-coach-catalog/1.0' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as { elements: OsmElement[] };
        return j.elements;
      } catch (e) {
        console.warn(`  ${url} failed (${e instanceof Error ? e.message : e}), retrying…`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }
  throw new Error('All Overpass servers failed');
}

const ll = (g: { lat: number; lon: number }): LatLon => ({ lat: g.lat, lon: g.lon });

function outlines(e: OsmElement): LatLon[][] {
  if (e.geometry) return [e.geometry.map(ll)];
  return (e.members ?? []).filter((m) => m.role === 'outer' && m.geometry?.length).map((m) => m.geometry!.map(ll));
}

function centreOf(e: OsmElement): LatLon | undefined {
  if (e.center) return ll(e.center);
  if (e.lat != null) return { lat: e.lat, lon: e.lon! };
  const pts = outlines(e).flat();
  if (!pts.length) return undefined;
  return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length };
}

const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
const pt = (p: LatLon): [number, number] => [r5(p.lat), r5(p.lon)];

async function main() {
  console.log('Fetching golf courses…');
  const courses = (await overpass(`[out:json][timeout:180];nwr["leisure"="golf_course"](${B});out geom tags;`)).filter((e) => e.tags?.name);
  console.log(`  ${courses.length} named courses`);
  console.log('Fetching holes and greens…');
  const features = await overpass(`[out:json][timeout:300];(way["golf"="hole"](${B});way["golf"="green"](${B});relation["golf"="green"](${B}););out geom tags;`);
  console.log(`  ${features.length} holes/greens`);
  console.log('Fetching bunkers, water and fairways…');
  // Only hazards that sit on a golf course (otherwise every dam and creek in SEQ comes back)
  const hazards = await overpass(
    `[out:json][timeout:300];nwr["leisure"="golf_course"](${B})->.c;.c map_to_area->.a;(way["golf"~"^(bunker|fairway|water_hazard|lateral_water_hazard)$"](area.a);way["natural"="water"](area.a););out geom tags;`,
  );
  console.log(`  ${hazards.length} hazards/fairways`);
  console.log('Fetching town names…');
  const places = (await overpass(`[out:json][timeout:120];node["place"~"^(suburb|town|city|village)$"](${B});out tags;`)).filter((p) => p.tags?.name && p.lat != null);

  // Which course does each hole/green belong to? Inside its boundary, else the nearest course centre within 1.5 km
  const bounds = courses.map((c) => ({ c, polys: outlines(c).filter((p) => p.length >= 3), centre: centreOf(c) }));
  const owned = new Map<OsmElement, OsmElement[]>(courses.map((c) => [c, []]));
  const isHazard = new Set(hazards);
  for (const f of [...features, ...hazards]) {
    const g = f.geometry ?? f.members?.find((m) => m.geometry)?.geometry;
    if (!g?.length) continue;
    const probe = ll(g[Math.floor(g.length / 2)]);
    let home = bounds.find((b) => b.polys.some((p) => pointInPolygon(probe, p) || g.some((q) => pointInPolygon(ll(q), p))))?.c;
    if (!home && !isHazard.has(f)) {
      const near = bounds.filter((b) => b.centre).map((b) => ({ b, d: distanceM(probe, b.centre!) })).sort((a, b) => a.d - b.d)[0];
      if (near && near.d < 1500) home = near.b.c;
    }
    if (home) owned.get(home)!.push(f);
  }

  const out: CatalogCourse[] = [];
  for (const { c, centre } of bounds) {
    if (!centre) continue;
    const ref = `${c.type}/${c.id}`;
    const place = places
      .map((p) => ({ p, d: distanceM(centre, { lat: p.lat!, lon: p.lon! }) }))
      .sort((a, b) => a.d - b.d)[0];
    const suburb = c.tags?.['addr:suburb'] ?? c.tags?.['addr:city'] ?? (place && place.d < 8000 ? place.p.tags!.name : undefined);
    const built = buildCourse({ osmRef: ref, name: c.tags!.name, location: centre, suburb, state: 'QLD' }, owned.get(c)!);
    const mapped = built.holes.filter((h) => h.tee || h.green?.polygon).length;
    out.push({
      ref,
      name: c.tags!.name,
      suburb,
      at: pt(centre),
      holes: mapped
        ? built.holes.map((h) => ({
            n: h.number,
            par: h.par,
            si: h.si,
            ...(h.lengthM ? { len: h.lengthM } : {}),
            ...(h.tee ? { tee: pt(h.tee) } : {}),
            ...(h.green ? { g: pt(h.green.centre) } : {}),
            ...(h.green?.polygon ? { poly: h.green.polygon.filter((_, i, a) => a.length <= 24 || i % Math.ceil(a.length / 24) === 0).map(pt) } : {}),
            ...(h.path ? { path: h.path.map(pt) } : {}),
          }))
        : undefined,
      hz: built.hazards?.length
        ? built.hazards.map((z) => ({ k: z.kind === 'bunker' ? ('b' as const) : z.kind === 'water' ? ('w' as const) : ('f' as const), p: z.poly.map(pt) }))
        : undefined,
    });
  }
  // Same course mapped twice (e.g. a boundary and a point): keep the one with more detail
  const byName = new Map<string, CatalogCourse>();
  for (const c of out) {
    const key = c.name.toLowerCase();
    const prev = byName.get(key);
    const score = (x?: CatalogCourse) => x?.holes?.length ?? 0;
    if (!prev || (score(c) > score(prev) && distanceM({ lat: c.at[0], lon: c.at[1] }, { lat: prev.at[0], lon: prev.at[1] }) < 3000)) byName.set(key, c);
    else if (distanceM({ lat: c.at[0], lon: c.at[1] }, { lat: prev.at[0], lon: prev.at[1] }) >= 3000) byName.set(`${key}@${c.ref}`, c);
  }
  const final = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  const catalog: Catalog = { v: 1, region: 'South East Queensland', generated: new Date().toISOString().slice(0, 10), courses: final };
  writeFileSync(new URL('../src/data/seq-courses.json', import.meta.url), JSON.stringify(catalog));
  const detailed = final.filter((c) => c.holes).length;
  console.log(`Wrote ${final.length} courses (${detailed} with hole detail).`);
  console.log(`Hazards: ${final.reduce((n, c) => n + (c.hz?.length ?? 0), 0)} across ${final.filter((c) => c.hz).length} courses; size ${(JSON.stringify(catalog).length / 1024).toFixed(0)} KB`);
  console.log('With hole detail:', final.filter((c) => c.holes).map((c) => `${c.name} (${c.holes!.filter((h) => h.g).length} greens)`).join('; '));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
