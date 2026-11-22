import type { Player } from '../types';
import { encodeBundle, friendUrl, makeBundle, personKey } from '../lib/share';
import { store, uid } from '../lib/storage';
import { liveAvailable } from './config';

/**
 * Linking up as friends. Each phone has a crew code; an app invite carries
 * it, and when a mate links up their name goes up under that code so the
 * inviter's phone adds them to Friends by itself.
 */
export interface CrewMate {
  name: string;
  ga: number;
  gaNo?: string;
  src?: 'ga' | 'manual';
  /** The mate's own crew code (so you can see when they're live). */
  crew?: string;
  at: number;
}

/** "I'm playing live": posted on your own crew channel for your friends' phones to see. */
export interface LiveNote {
  kind: 'live';
  name: string;
  code: string;
  course: string;
  hole: number;
  headline: string;
  final: boolean;
  at: number;
}

export function myCrewCode(): string {
  try {
    let c = localStorage.getItem('gtg.crew');
    if (!c) {
      c = uid().slice(0, 10);
      localStorage.setItem('gtg.crew', c);
    }
    return c;
  } catch {
    return 'none';
  }
}

const channel = (code: string) => `crew-${code}`;

/**
 * Crew codes from this person's other copies of the app (on iPhone, Safari and
 * the Home Screen app keep separate data). Invites sent from those still land here.
 */
export function extraCrewCodes(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem('gtg.extraCrews') || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.length >= 6) : [];
  } catch {
    return [];
  }
}
export function addExtraCrewCode(code: string) {
  if (!code || code === myCrewCode() || extraCrewCodes().includes(code)) return;
  try {
    localStorage.setItem('gtg.extraCrews', JSON.stringify([...extraCrewCodes(), code].slice(-5)));
  } catch {
    /* private mode */
  }
}
export const myCrewCodes = () => [myCrewCode(), ...extraCrewCodes()];

export async function announceLinkUp(code: string, me: Player): Promise<void> {
  if (!liveAvailable()) throw new Error('Live sync is not set up');
  const { pushGroup } = await import('./live');
  const mate: CrewMate = { name: me.name, ga: me.gaHandicap, gaNo: me.gaNumber, src: me.hcpSource, crew: myCrewCode(), at: Date.now() };
  let slot = '';
  try {
    slot = localStorage.getItem(`gtg.crewSlot.${code}`) ?? '';
    if (!slot) {
      slot = 'j' + uid().slice(0, 8);
      localStorage.setItem(`gtg.crewSlot.${code}`, slot);
    }
  } catch {
    slot = 'j' + uid().slice(0, 8);
  }
  await pushGroup(channel(code), slot, { data: JSON.stringify(mate), status: 'live', hole: 0, headline: 'mate', scorer: me.name });
}

/** Watch this phone's crew code; adds anyone who linked up. Calls back with the names added. */
export async function watchMyCrew(onAdded: (names: string[]) => void): Promise<() => void> {
  if (!liveAvailable()) return () => undefined;
  const { watchEvent } = await import('./live');
  const handle = (docs: Record<string, { data: string }> | null) => {
      const me = store.settings().me;
      const friends = store.friends();
      const added: string[] = [];
      let updated = false;
      // Newest details per mate win (they may have linked from Safari and again from the app)
      const latest = new Map<string, CrewMate>();
      for (const d of Object.values(docs ?? {})) {
        try {
          const m = JSON.parse(d.data) as CrewMate & { kind?: string };
          if (m.kind) continue; // not a link-up (e.g. this phone's own live note)
          const name = String(m.name ?? '').trim().slice(0, 40);
          if (!name) continue;
          const key = personKey(name);
          if (key === personKey(me.name)) continue;
          const prev = latest.get(key);
          if (!prev || (Number(m.at) || 0) > prev.at) latest.set(key, { ...m, name, at: Number(m.at) || 0 });
        } catch {
          /* skip */
        }
      }
      for (const [key, m] of latest) {
        const details = {
          ...(typeof m.crew === 'string' && m.crew ? { crew: m.crew.slice(0, 20) } : {}),
          gaHandicap: Number(m.ga) || 0,
          ...(m.gaNo ? { gaNumber: String(m.gaNo) } : {}),
          ...(m.src === 'manual' || m.src === 'ga' ? { hcpSource: m.src } : {}),
        };
        const have = friends.find((f) => personKey(f.name) === key);
        if (have) {
          const changed = (details.crew && have.crew !== details.crew) || have.gaHandicap !== details.gaHandicap || (details.gaNumber && have.gaNumber !== details.gaNumber) || (details.hcpSource && have.hcpSource !== details.hcpSource);
          if (changed) {
            store.saveFriend({ ...have, ...details });
            updated = true;
          }
          continue;
        }
        const f: Player = { id: uid(), name: m.name, ...details, linkedAt: Date.now() };
        store.saveFriend(f);
        friends.push(f);
        added.push(m.name);
      }
      // Called when anyone was added or their details changed (names = the new ones)
      if (added.length || updated) onAdded(added);
  };
  const unsubs = await Promise.all(myCrewCodes().map((c) => watchEvent(channel(c), handle, () => undefined)));
  return () => unsubs.forEach((u) => u());
}

/** Tell your friends you're playing live (and where you're up to). Cheap: one small entry, overwritten. */
export async function announcePresence(note: Omit<LiveNote, 'kind' | 'at'>): Promise<void> {
  if (!liveAvailable()) return;
  const { pushGroup } = await import('./live');
  const full: LiveNote = { kind: 'live', ...note, at: Date.now() };
  const doc = { data: JSON.stringify(full), status: note.final ? ('final' as const) : ('live' as const), hole: note.hole, headline: note.headline, scorer: note.name };
  await pushGroup(channel(myCrewCode()), 'live', doc);
  // Mates who linked up through your other copy of the app (e.g. Safari) watch that code
  await Promise.all(extraCrewCodes().map((c) => pushGroup(channel(c), 'live', doc).catch(() => undefined)));
}

/** Friends who are playing live right now (rounds started or updated in the last 6 hours). */
export async function watchFriendsLive(crews: string[], onLive: (live: LiveNote[]) => void): Promise<() => void> {
  if (!liveAvailable() || !crews.length) return () => undefined;
  const { watchPrefix } = await import('./live');
  const current = new Map<string, LiveNote>();
  // Live rounds (last 6 hours), plus rounds finished in the last 12 so mates can still watch the replay
  const emit = () =>
    onLive([...current.values()].filter((n) => (n.final ? Date.now() - n.at < 12 * 3600 * 1000 : Date.now() - n.at < 6 * 3600 * 1000)).sort((a, b) => Number(a.final) - Number(b.final) || b.at - a.at));
  const unsubs = await Promise.all(
    crews.map((c) =>
      watchPrefix(
        channel(c),
        'live',
        (docs) => {
          const d = docs?.live;
          try {
            const n = d ? (JSON.parse(d.data) as LiveNote) : null;
            if (n?.kind === 'live' && typeof n.code === 'string') current.set(c, n);
            else current.delete(c);
          } catch {
            current.delete(c);
          }
          emit();
        },
        () => undefined,
      ),
    ),
  );
  return () => unsubs.forEach((u) => u());
}

/** Your own friend invite link (your name, handicap and crew code). */
export async function myFriendInviteUrl(): Promise<string> {
  const s = store.settings();
  const b = {
    ...makeBundle({ me: s.me, friends: [], rounds: [], comps: [] }),
    people: [{ key: personKey(s.me.name), name: s.me.name, ga: s.me.gaHandicap, ...(s.me.gaNumber ? { gaNo: s.me.gaNumber } : {}), ...(s.me.hcpSource ? { src: s.me.hcpSource } : {}) }],
    crew: myCrewCode(),
  };
  return friendUrl(await encodeBundle(b));
}

// Link-ups that didn't get through (no signal, server hiccup): kept and retried until they land
const PENDING = 'gtg.pendingLinkUps';
function readPending(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function writePending(codes: string[]) {
  try {
    if (codes.length) localStorage.setItem(PENDING, JSON.stringify([...new Set(codes)]));
    else localStorage.removeItem(PENDING);
  } catch {
    /* private mode */
  }
}

// With no signal Firebase just waits, so give up after a bit (the write still goes once the signal's back)
const within = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, bad) => setTimeout(() => bad(new Error('timeout')), ms))]);

/** Tell the inviter's phone you've linked up; if it can't get through now, it's retried later. */
export async function linkUpWithRetry(code: string, me: Player): Promise<boolean> {
  try {
    await within(announceLinkUp(code, me), 8000);
    writePending(readPending().filter((c) => c !== code));
    return true;
  } catch {
    writePending([...readPending(), code]);
    return false;
  }
}

/** Retry any link-ups still waiting (called when the app opens and when the signal comes back). */
export async function retryPendingLinkUps(): Promise<number> {
  const codes = readPending();
  if (!codes.length || !liveAvailable()) return 0;
  const me = store.settings().me;
  if (!me.name || me.name === 'Me') return 0;
  let sent = 0;
  for (const c of codes) {
    try {
      await within(announceLinkUp(c, me), 15000);
      writePending(readPending().filter((x) => x !== c));
      sent++;
    } catch {
      /* still no luck: try again next time */
    }
  }
  return sent;
}

/** A link that copies this copy's friends (and its crew code) into your other copy of the app. */
export async function myMoveFriendsUrl(): Promise<string> {
  const s = store.settings();
  const b = {
    ...makeBundle({ me: s.me, friends: [], rounds: [], comps: [] }),
    people: store.friends().map((f) => ({
      key: personKey(f.name),
      name: f.name,
      ga: f.gaHandicap,
      ...(f.gaNumber ? { gaNo: f.gaNumber } : {}),
      ...(f.hcpSource ? { src: f.hcpSource } : {}),
      ...(f.crew ? { crew: f.crew } : {}),
    })),
    crew: myCrewCode(),
  };
  return `${location.origin}${location.pathname}#move=${await encodeBundle(b)}`;
}

/** Take friends from your other copy of the app. Returns the names added. */
export function takeMovedFriends(b: { crew?: string; people: { name: string; ga: number; gaNo?: string; src?: 'ga' | 'manual'; crew?: string }[] }): string[] {
  const me = store.settings().me;
  const friends = store.friends();
  const added: string[] = [];
  for (const p of b.people) {
    const key = personKey(p.name);
    if (key === personKey(me.name)) continue;
    const have = friends.find((f) => personKey(f.name) === key);
    if (have) {
      if (p.crew && !have.crew) store.saveFriend({ ...have, crew: p.crew });
      continue;
    }
    const f: Player = { id: uid(), name: p.name, gaHandicap: p.ga, ...(p.gaNo ? { gaNumber: p.gaNo } : {}), ...(p.src ? { hcpSource: p.src } : {}), ...(p.crew ? { crew: p.crew } : {}), linkedAt: Date.now() };
    store.saveFriend(f);
    friends.push(f);
    added.push(p.name);
  }
  if (b.crew) addExtraCrewCode(b.crew);
  return added;
}
