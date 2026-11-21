import { liveAvailable } from './config';

/**
 * Sim shot clips for mates watching a live round. Each clip goes up under
 * the event's clip channel as an index entry ("i…") plus its video in a few
 * chunks ("c…"), within the existing database rules (each entry under 300 KB).
 * Every phone keeps a ring of its last 6 clips, so old ones are overwritten
 * rather than piling up.
 */
export interface ClipMeta {
  id: string;
  name: string;
  club?: string;
  info: string[];
  parts: number;
  mime: string;
  at: number;
  hole?: number;
}

const channel = (code: string) => `vid-${code}`;
const CHUNK = 240_000; // characters of base64 per entry
const RING = 6;

function phoneTag(): string {
  try {
    let t = localStorage.getItem('gtg.clipTag');
    if (!t) {
      t = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
      localStorage.setItem('gtg.clipTag', t);
    }
    return t;
  } catch {
    return 'anon';
  }
}

function nextSlot(): string {
  let n = 0;
  try {
    n = (Number(localStorage.getItem('gtg.clipRing')) || 0) % RING;
    localStorage.setItem('gtg.clipRing', String(n + 1));
  } catch {
    /* ignore */
  }
  return phoneTag() + n;
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function publishClip(code: string, blob: Blob, meta: Omit<ClipMeta, 'id' | 'parts' | 'at'>): Promise<ClipMeta> {
  if (!liveAvailable()) throw new Error('Live sync is not set up');
  const { pushGroup } = await import('./live');
  const id = nextSlot();
  const b64 = await toBase64(blob);
  const parts = Math.ceil(b64.length / CHUNK);
  if (parts > 6) throw new Error('Clip too big to send');
  for (let i = 0; i < parts; i++) {
    await pushGroup(channel(code), `c${id}${i}`, { data: b64.slice(i * CHUNK, (i + 1) * CHUNK), status: 'live', hole: 0, headline: 'clip', scorer: meta.name });
  }
  const full: ClipMeta = { ...meta, id, parts, at: Date.now() };
  // The index goes up last, so watchers never see a clip that isn't all there
  await pushGroup(channel(code), `i${id}`, { data: JSON.stringify(full), status: 'live', hole: meta.hole ?? 0, headline: 'clip', scorer: meta.name });
  return full;
}

/** Newest first. */
export async function watchClips(code: string, onClips: (c: ClipMeta[]) => void): Promise<() => void> {
  if (!liveAvailable()) return () => undefined;
  const { watchPrefix } = await import('./live');
  return watchPrefix(
    channel(code),
    'i',
    (docs) => {
      const out: ClipMeta[] = [];
      for (const d of Object.values(docs ?? {})) {
        try {
          const m = JSON.parse(d.data) as ClipMeta;
          if (m && typeof m.id === 'string' && m.parts > 0 && m.parts <= 6) out.push(m);
        } catch {
          /* skip */
        }
      }
      onClips(out.sort((a, b) => b.at - a.at));
    },
    () => undefined,
  );
}

const cache = new Map<string, Promise<string>>();

/** Download a clip and give back a playable URL (cached for this visit). */
export function loadClip(code: string, m: ClipMeta): Promise<string> {
  const key = `${code}|${m.id}|${m.at}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const { getEntry } = await import('./live');
      const parts = await Promise.all(Array.from({ length: m.parts }, (_, i) => getEntry(channel(code), `c${m.id}${i}`)));
      if (parts.some((x) => !x)) throw new Error('Clip not all there yet');
      const b64 = parts.map((x) => x!.data).join('');
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return URL.createObjectURL(new Blob([bytes], { type: m.mime }));
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}
