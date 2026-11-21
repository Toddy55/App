/**
 * Fallback for when OpenStreetMap's servers are down at build time: copy the
 * course list from the version of the app that's already live, so a deploy
 * never ships with an empty course dropdown.
 *
 * Usage: node scripts/fetch-live-catalog.mjs https://owner.github.io/Repo/
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const base = (process.argv[2] ?? '').replace(/\/?$/, '/');
const out = new URL('../src/data/seq-courses.json', import.meta.url);

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

function valid(c) {
  return c && Array.isArray(c.courses) && c.courses.length > 0;
}

async function main() {
  // Newer deploys publish the list as a plain file.
  try {
    const c = JSON.parse(await get(`${base}seq-courses.json`));
    if (valid(c)) return save(c, 'seq-courses.json');
  } catch (e) {
    console.log(`  no plain copy (${e.message}), looking in the app bundle…`);
  }
  // Older deploys only have it inside the bundled app: find that chunk and load it.
  const html = await get(base);
  const entries = [...html.matchAll(/assets\/index-[\w-]+\.js/g)].map((m) => m[0]);
  for (const entry of entries) {
    const js = await get(base + entry);
    const chunk = js.match(/seq-courses-[\w-]+\.js/)?.[0];
    if (!chunk) continue;
    const dir = mkdtempSync(join(tmpdir(), 'catalog-'));
    const file = join(dir, 'chunk.mjs');
    writeFileSync(file, await get(`${base}assets/${chunk}`));
    const mod = await import(pathToFileURL(file).href);
    const c = mod.default ?? mod;
    if (valid(c)) return save(c, chunk);
  }
  throw new Error('No course list found on the live site');
}

function save(c, from) {
  writeFileSync(out, JSON.stringify(c));
  console.log(`Kept the live course list (${c.courses.length} courses, from ${from}, generated ${c.generated || 'unknown'})`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
