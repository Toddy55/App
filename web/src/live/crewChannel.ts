import type { Player } from '../types';
import { personKey } from '../lib/share';
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
  return watchEvent(
    channel(myCrewCode()),
    (docs) => {
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
        const f: Player = { id: uid(), name: m.name, ...details };
        store.saveFriend(f);
        friends.push(f);
        added.push(m.name);
      }
      // Called when anyone was added or their details changed (names = the new ones)
      if (added.length || updated) onAdded(added);
    },
    () => undefined,
  );
}

/** Tell your friends you're playing live (and where you're up to). Cheap: one small entry, overwritten. */
export async function announcePresence(note: Omit<LiveNote, 'kind' | 'at'>): Promise<void> {
  if (!liveAvailable()) return;
  const { pushGroup } = await import('./live');
  const full: LiveNote = { kind: 'live', ...note, at: Date.now() };
  await pushGroup(channel(myCrewCode()), 'live', { data: JSON.stringify(full), status: note.final ? 'final' : 'live', hole: note.hole, headline: note.headline, scorer: note.name });
}

/** Friends who are playing live right now (rounds started or updated in the last 6 hours). */
export async function watchFriendsLive(crews: string[], onLive: (live: LiveNote[]) => void): Promise<() => void> {
  if (!liveAvailable() || !crews.length) return () => undefined;
  const { watchPrefix } = await import('./live');
  const current = new Map<string, LiveNote>();
  const emit = () => onLive([...current.values()].filter((n) => !n.final && Date.now() - n.at < 6 * 3600 * 1000).sort((a, b) => b.at - a.at));
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
