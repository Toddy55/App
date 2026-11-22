import type { Competition, Player, Round } from '../types';

/**
 * Rounds and comps travel between phones as a link (or file). Player ids are
 * local to each phone, so inside a bundle every player is identified by name
 * and the receiver maps each name to one of their own friends (or themselves).
 */
export interface Person {
  key: string;
  name: string;
  ga: number;
  /** GA (GOLF Link) number, if known. */
  gaNo?: string;
  /** 'manual' for players without a GA handicap. */
  src?: 'ga' | 'manual';
  /** Their crew code, so friends can see when they're live. */
  crew?: string;
}

export interface Bundle {
  v: 1;
  from: string;
  /** Friend links: the inviter's crew code, so they're told when you link up. */
  crew?: string;
  people: Person[];
  rounds: Round[];
  comps: Competition[];
}

export const personKey = (name: string) => 'p:' + name.trim().toLowerCase().replace(/\s+/g, ' ');

function remapRound(r: Round, map: (id: string) => string): Round {
  const scores: Round['scores'] = {};
  for (const [k, v] of Object.entries(r.scores)) scores[r.teams?.some((t) => t.id === k) ? k : map(k)] = v;
  const stats: Round['stats'] = {};
  for (const [k, v] of Object.entries(r.stats ?? {})) stats[Number(k)] = v.drivePlayerId ? { ...v, drivePlayerId: map(v.drivePlayerId) } : v;
  return {
    ...r,
    players: r.players.map((p) => ({ ...p, id: map(p.id) })),
    teams: r.teams?.map((t) => ({ ...t, playerIds: t.playerIds.map(map) })),
    scores,
    stats,
    meId: r.teams?.some((t) => t.id === r.meId) ? r.meId : map(r.meId),
  };
}

export function makeBundle(opts: { me: Player; friends: Player[]; rounds: Round[]; comps: Competition[]; keepShotsOf?: string | 'all' }): Bundle {
  const people = new Map<string, Person>();
  const nameOf = (id: string) => (id === 'me' ? opts.me.name : opts.friends.find((f) => f.id === id)?.name);
  const toKey = (id: string, fallbackName?: string, ga = 0) => {
    const name = nameOf(id) ?? fallbackName ?? id;
    const key = personKey(name);
    if (!people.has(key)) {
      const f = id === 'me' ? opts.me : opts.friends.find((x) => x.id === id);
      const crew = id === 'me' ? myCrew() : f?.crew;
      people.set(key, { key, name, ga: f?.gaHandicap ?? ga, ...(f?.gaNumber ? { gaNo: f.gaNumber } : {}), ...(f?.hcpSource ? { src: f.hcpSource } : {}), ...(crew ? { crew } : {}) });
    }
    return key;
  };
  const rounds = opts.rounds.map((r) => {
    r.players.forEach((p) => toKey(p.id, p.name, p.gaHandicap));
    const lookup = (id: string) => toKey(id, r.players.find((p) => p.id === id)?.name);
    // Shots, stats, AI write-ups and pins are personal; leave them on the sender's phone.
    // ...except your live round's shots and pins, so mates can watch the replay
    const keep = opts.keepShotsOf === 'all' || opts.keepShotsOf === r.id;
    const { aiReport: _a, liveCode: _l, balls: _b, siriMarks: _s, ...rest } = remapRound({ ...r, shots: keep ? r.shots : {}, pins: keep ? r.pins : {}, stats: opts.keepShotsOf === 'all' ? r.stats ?? {} : {} }, lookup);
    void _b;
    void _s;
    void _l;
    void _a;
    return rest as Round;
  });
  const comps = opts.comps.map((c) => ({ ...c, memberIds: c.memberIds.map((id) => toKey(id)) }));
  return { v: 1, from: opts.me.name, people: [...people.values()], rounds, comps };
}

export type Mapping = Record<string, string | 'new'>;

/** Best guess at who each person in a bundle is on this phone. */
export function autoMap(bundle: Bundle, me: Player, friends: Player[]): Mapping {
  const m: Mapping = {};
  for (const p of bundle.people) {
    // "Me" is the name a copy has before it's set up: that's you, not a mate called Me
    if (personKey(me.name) === p.key || p.key === personKey('Me')) m[p.key] = 'me';
    else m[p.key] = friends.find((f) => personKey(f.name) === p.key)?.id ?? 'new';
  }
  return m;
}

export interface ImportPlan {
  newFriends: Player[];
  rounds: Round[];
  comps: Competition[];
}

/** Turn a bundle into local records using the confirmed mapping. */
export function applyBundle(bundle: Bundle, mapping: Mapping, makeId: () => string): ImportPlan {
  const ids: Record<string, string> = {};
  const newFriends: Player[] = [];
  for (const p of bundle.people) {
    const m = mapping[p.key] ?? 'new';
    if (m === 'new') {
      const id = makeId();
      ids[p.key] = id;
      newFriends.push({ id, name: p.name, gaHandicap: p.ga, ...(p.gaNo ? { gaNumber: p.gaNo } : {}), ...(p.src ? { hcpSource: p.src } : {}), ...(p.crew ? { crew: p.crew } : {}) });
    } else ids[p.key] = m;
  }
  const map = (k: string) => ids[k] ?? k;
  const rounds = bundle.rounds.map((r) => {
    const local = remapRound(r, map);
    const myTeam = local.teams?.find((t) => t.playerIds.includes('me'));
    const meId = myTeam ? myTeam.id : local.players.some((p) => p.id === 'me') ? 'me' : local.meId;
    // The sender's putts/fairways describe the sender's game; only keep them if the sender is "me".
    const keepStats = meId === local.meId;
    return { ...local, meId, stats: keepStats ? local.stats : {}, sharedBy: bundle.from } as Round;
  });
  const comps = bundle.comps.map((c) => ({ ...c, memberIds: c.memberIds.map(map) }));
  return { newFriends, rounds, comps };
}

// --- link encoding (deflate + base64url) ---

function toB64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64Url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const res = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export async function encodeBundle(b: Bundle): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(b));
  if (typeof CompressionStream === 'undefined') return 'j' + toB64Url(raw);
  return 'z' + toB64Url(await pipe(raw, new CompressionStream('deflate-raw')));
}

export async function decodeBundle(s: string): Promise<Bundle> {
  const kind = s[0];
  const bytes = fromB64Url(s.slice(1));
  const raw = kind === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
  const b = JSON.parse(new TextDecoder().decode(raw)) as Bundle;
  if (b.v !== 1 || !Array.isArray(b.people)) throw new Error('This link is from a different version of the app.');
  return b;
}

/** A friend link: opens the "Link up" screen. */
export function friendUrl(encoded: string): string {
  return `${location.origin}${location.pathname}#friend=${encoded}`;
}

/** A comp invite: opens the "Join a comp" screen. */
export function joinUrl(encoded: string): string {
  return `${location.origin}${location.pathname}#join=${encoded}`;
}

export function shareUrl(encoded: string): string {
  return `${location.origin}${location.pathname}#import=${encoded}`;
}

/** Share via the phone's share sheet, falling back to the clipboard. */
export async function shareLink(title: string, text: string, url: string): Promise<'shared' | 'copied'> {
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
  if (nav.share) {
    try {
      await nav.share({ title, text, url });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'shared';
    }
  }
  await navigator.clipboard.writeText(`${text}\n${url}`);
  return 'copied';
}

export async function shareText(title: string, text: string): Promise<'shared' | 'copied'> {
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
  if (nav.share) {
    try {
      await nav.share({ title, text });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'shared';
    }
  }
  await navigator.clipboard.writeText(text);
  return 'copied';
}

/** This phone's crew code, if it has one yet (made when you first invite or link up). */
function myCrew(): string | undefined {
  try {
    return localStorage.getItem('gtg.crew') ?? undefined;
  } catch {
    return undefined;
  }
}
