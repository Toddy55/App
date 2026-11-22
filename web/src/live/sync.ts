import type { Competition, Course, Player, Round, Settings } from '../types';
import { personKey } from '../lib/share';
import { quietly, stamp, stamps, store, type SyncKind } from '../lib/storage';
import { liveAvailable } from './config';
import { addExtraCrewCode, myCrewCode } from './crewChannel';

/**
 * Your data in every copy of the app: Safari, the Home Screen app, a new phone.
 * Each copy keeps rounds, friends, comps, courses and settings under a private
 * sync key in the cloud; linked copies share the key, so a change in one shows
 * up in the others. Newest change wins, record by record.
 */
interface Rec {
  at: number;
  /** The record, as JSON. Missing = deleted. */
  d?: string;
}
type Tree = Partial<Record<SyncKind, Record<string, Rec>>>;

const KEY = 'gtg.syncKey';
const KINDS: SyncKind[] = ['s', 'f', 'r', 'c', 'k'];

export function syncKey(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
function setKey(k: string | null) {
  try {
    if (k) localStorage.setItem(KEY, k);
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}
function newKey(): string {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 28);
}

/** The link that joins another copy of the app (or another phone) to this one's data. */
export function syncLink(key = syncKey()): string | null {
  return key ? `${location.origin}${location.pathname}#sync=${key}` : null;
}

// Firebase keys can't hold . # $ [ ] /
const enc = (id: string) => id.replace(/[.#$[\]/%]/g, (c) => `%${c.charCodeAt(0).toString(16)}`);

/** This copy's records, as sync sees them. */
function local(kind: SyncKind): Map<string, { id: string; json: string }> {
  const m = new Map<string, { id: string; json: string }>();
  const add = (id: string, v: unknown) => m.set(enc(id), { id, json: JSON.stringify(v) });
  if (kind === 's') add('me', store.settings());
  if (kind === 'f') store.friends().forEach((f) => add(f.id, f));
  if (kind === 'r') store.rounds().forEach((r) => add(r.id, r));
  if (kind === 'c') store.comps().forEach((c) => add(c.id, c));
  if (kind === 'k') store.courses().forEach((c) => add(c.id, c));
  return m;
}
/** When this copy last changed a record (negative = deleted; 1 = from before sync). */
const localAt = (all: Record<string, number>, kind: SyncKind, id: string) => all[`${kind}:${id}`] ?? (local(kind).has(enc(id)) ? 1 : 0);

/** Put a record from another copy into this one. */
function put(kind: SyncKind, rec: Rec) {
  const v = rec.d ? JSON.parse(rec.d) : null;
  quietly(() => {
    if (kind === 's' && v) store.saveSettings({ ...(v as Settings) });
    if (kind === 'f' && v) store.saveFriend(v as Player);
    if (kind === 'r' && v) store.saveRound(v as Round);
    if (kind === 'c' && v) store.saveComp(v as Competition);
    if (kind === 'k' && v) store.saveCourse(v as Course);
  });
}
function remove(kind: SyncKind, id: string) {
  quietly(() => {
    if (kind === 'f') store.deleteFriend(id);
    if (kind === 'r') store.deleteRound(id);
    if (kind === 'c') store.deleteComp(id);
    if (kind === 'k') store.deleteCourse(id);
  });
}

/**
 * The same mate added separately in two copies (e.g. Jarrod in Safari and in the
 * app) has two ids. Keep the one already in the cloud and point everything at it.
 */
function mergeFriend(incoming: Player) {
  const twin = store.friends().find((f) => f.id !== incoming.id && ((f.crew && f.crew === incoming.crew) || personKey(f.name) === personKey(incoming.name)));
  if (!twin) return;
  const swap = (id: string) => (id === twin.id ? incoming.id : id);
  for (const r of store.rounds()) {
    if (!r.players.some((p) => p.id === twin.id)) continue;
    const scores: Round['scores'] = {};
    for (const [k, v] of Object.entries(r.scores)) scores[swap(k)] = v;
    const stats: Round['stats'] = {};
    for (const [k, v] of Object.entries(r.stats ?? {})) stats[Number(k)] = v.drivePlayerId ? { ...v, drivePlayerId: swap(v.drivePlayerId) } : v;
    store.saveRound({
      ...r,
      players: r.players.map((p) => ({ ...p, id: swap(p.id) })),
      teams: r.teams?.map((t) => ({ ...t, playerIds: t.playerIds.map(swap) })),
      scores,
      stats,
      meId: swap(r.meId),
    });
  }
  for (const c of store.comps()) if (c.memberIds.includes(twin.id)) store.saveComp({ ...c, memberIds: [...new Set(c.memberIds.map(swap))] });
  store.deleteFriend(twin.id);
}

let running: { key: string; stop: () => void } | null = null;
let lastSync = 0;
export const lastSyncedAt = () => lastSync;

/** Merge the cloud copy in, send ours up, then keep both in step. */
export async function startSync(): Promise<void> {
  const key = syncKey();
  if (!key || !liveAvailable()) return;
  if (running?.key === key) return;
  running?.stop();
  const { syncGet, syncSet, syncWatch } = await import('./live');

  // Send one record (or its deletion) up
  const send = (kind: SyncKind, id: string) => {
    const at = Math.abs(stamps()[`${kind}:${id}`] ?? 1);
    const rec = local(kind).get(enc(id));
    return syncSet(`${key}/${kind}/${enc(id)}`, rec ? { at, d: rec.json } : { at }).then(() => (lastSync = Date.now()));
  };

  // Take in whatever's newer in the cloud; returns true if anything changed here
  const take = (tree: Tree | null) => {
    let changed = false;
    const all = stamps();
    for (const kind of KINDS) {
      for (const [k, rec] of Object.entries(tree?.[kind] ?? {})) {
        if (!rec || typeof rec.at !== 'number') continue;
        const id = rec.d ? (kind === 's' ? 'me' : (JSON.parse(rec.d) as { id: string }).id) : decodeURIComponent(k.replace(/%(?![0-9a-f]{2})/g, '%25'));
        const mine = Math.abs(localAt(all, kind, id));
        if (rec.at <= mine) continue;
        if (kind === 'f' && rec.d) mergeFriend(JSON.parse(rec.d) as Player);
        if (rec.d) put(kind, rec);
        else remove(kind, id);
        quietly(() => stamp(kind, id, rec.at, !rec.d));
        changed = true;
      }
    }
    if (changed) window.dispatchEvent(new Event('gtg:synced'));
    return changed;
  };

  // First time round: pull, merge, push anything only (or newer) here
  const tree = await syncGet<Tree>(key);
  take(tree);
  const all = stamps();
  const ups: Promise<unknown>[] = [];
  for (const kind of KINDS) {
    const theirs = tree?.[kind] ?? {};
    for (const [k, rec] of local(kind)) {
      const at = Math.abs(localAt(all, kind, rec.id));
      if (!theirs[k] || theirs[k].at < at) ups.push(send(kind, rec.id));
    }
    // Deleted here since
    for (const [sk, at] of Object.entries(all)) {
      if (!sk.startsWith(`${kind}:`) || at >= 0) continue;
      const id = sk.slice(2);
      const t = theirs[enc(id)];
      if (t?.d && t.at < -at) ups.push(send(kind, id));
    }
  }
  // Each copy's crew code, so invites sent from any of them land in all of them
  ups.push(syncSet(`${key}/crews/${myCrewCode()}`, Date.now()));
  await Promise.all(ups.map((p) => p.catch(() => undefined)));
  lastSync = Date.now();

  // From now on: changes here go up, changes there come down
  const pending = new Map<string, { kind: SyncKind; id: string }>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onChange = (e: Event) => {
    const { kind, id } = (e as CustomEvent<{ kind: SyncKind; id: string }>).detail;
    pending.set(`${kind}:${id}`, { kind, id });
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const list = [...pending.values()];
      pending.clear();
      list.forEach((x) => send(x.kind, x.id).catch(() => pending.set(`${x.kind}:${x.id}`, x)));
    }, 1200);
  };
  window.addEventListener('gtg:changed', onChange);
  const unsubs = await Promise.all([
    ...KINDS.map((kind) => syncWatch<Record<string, Rec>>(`${key}/${kind}`, (v) => take({ [kind]: v ?? {} }))),
    syncWatch<Record<string, number>>(`${key}/crews`, (v) => {
      let added = false;
      for (const c of Object.keys(v ?? {})) {
        if (c !== myCrewCode()) {
          addExtraCrewCode(c);
          added = true;
        }
      }
      if (added) window.dispatchEvent(new Event('gtg:friends'));
    }),
  ]);
  running = {
    key,
    stop: () => {
      window.removeEventListener('gtg:changed', onChange);
      unsubs.forEach((u) => u());
    },
  };
}

/** Turn sync on for this copy (a new private key) and back everything up. */
export async function turnOnSync(): Promise<string> {
  const k = syncKey() ?? newKey();
  setKey(k);
  // The link works straight away; the backup carries on in the background (even with no signal yet)
  startSync().catch(() => undefined);
  return k;
}

/** Join this copy to another copy's data (from its sync link). */
export async function joinSync(key: string): Promise<void> {
  if (!/^[a-z0-9]{24,40}$/.test(key)) throw new Error("That sync link doesn't look right. Copy the whole link again.");
  if (syncKey() === key) return startSync();
  running?.stop();
  running = null;
  setKey(key);
  await startSync();
}

export function stopSync() {
  running?.stop();
  running = null;
  setKey(null);
}
