import type { Aids, Competition, Player } from '../types';
import { personKey } from '../lib/share';
import { store, uid } from '../lib/storage';
import { liveAvailable } from './config';

/**
 * Who's in a comp, kept in step across everyone's phones. When a mate opens
 * an invite link and joins, their name goes up under the comp's own channel
 * (it rides on the same Firebase space as live scoring), and every phone that
 * has the comp open adds them to its member list.
 */
export interface Joiner {
  name: string;
  ga: number;
  at: number;
}

const channel = (comp: Competition) => `comp-${comp.id}`;

function slot(comp: Competition): string {
  const k = `gtg.compSlot.${comp.id}`;
  try {
    const have = localStorage.getItem(k);
    if (have) return have;
    const s = 'j' + uid().slice(0, 8);
    localStorage.setItem(k, s);
    return s;
  } catch {
    return 'j' + uid().slice(0, 8);
  }
}

/** Tell everyone in the comp that this phone's golfer is in. */
export async function announceJoin(comp: Competition, me: Player): Promise<void> {
  if (!liveAvailable()) throw new Error('Live sync is not set up');
  const { pushGroup } = await import('./live');
  const j: Joiner = { name: me.name, ga: me.gaHandicap, at: Date.now() };
  await pushGroup(channel(comp), slot(comp), { data: JSON.stringify(j), status: 'live', hole: 0, headline: 'joined', scorer: me.name });
}

/** A round counting towards the comp that's being scored live right now. */
export interface LiveRoundNote {
  kind: 'live';
  code: string;
  course: string;
  scorer: string;
  at: number;
}

/** Let everyone in the round's comps know it's live, so they can watch from the comp page. */
export async function announceLive(compIds: string[], code: string, group: string, course: string, scorer: string): Promise<void> {
  if (!liveAvailable() || !compIds.length) return;
  const { pushGroup } = await import('./live');
  const note: LiveRoundNote = { kind: 'live', code, course, scorer, at: Date.now() };
  await Promise.all(
    compIds.map((id) =>
      pushGroup(`comp-${id}`, ('L' + group).slice(0, 12), { data: JSON.stringify(note), status: 'live', hole: 0, headline: 'live', scorer }),
    ),
  );
}

/** The organiser's tournament rules, posted so every member's phone follows them. */
export interface RulesNote {
  kind: 'rules';
  aids: Aids;
  by: string;
  at: number;
}

export async function publishRules(comp: Competition, by: string): Promise<void> {
  if (!liveAvailable()) return;
  const { pushGroup } = await import('./live');
  const note: RulesNote = { kind: 'rules', aids: comp.aids ?? 'full', by, at: Date.now() };
  // The first phone to write 'rules' owns it, so only the organiser can change them
  await pushGroup(channel(comp), 'rules', { data: JSON.stringify(note), status: 'live', hole: 0, headline: 'rules', scorer: by });
}

/** Take the organiser's rules into this phone's copy of the comp. Returns true if anything changed. */
export function applyRules(comp: Competition, rules: RulesNote | undefined): boolean {
  if (!rules) return false;
  if (comp.organiser && personKey(comp.organiser) !== personKey(rules.by)) return false;
  if ((comp.aids ?? 'full') === rules.aids && comp.organiser) return false;
  store.saveComp({ ...comp, aids: rules.aids, organiser: comp.organiser ?? rules.by });
  return true;
}

/** Watch the comp's channel: mates who joined from a link, rounds being scored live, and the tournament rules. */
export async function watchJoiners(
  comp: Competition,
  onJoiners: (j: Joiner[], live: LiveRoundNote[], rules?: RulesNote) => void,
): Promise<() => void> {
  if (!liveAvailable()) return () => undefined;
  const { watchEvent } = await import('./live');
  return watchEvent(
    channel(comp),
    (docs) => {
      const list: Joiner[] = [];
      const live: LiveRoundNote[] = [];
      let rules: RulesNote | undefined;
      for (const d of Object.values(docs ?? {})) {
        try {
          const j = JSON.parse(d.data) as Joiner & Partial<LiveRoundNote> & Partial<RulesNote>;
          if (j?.kind === 'rules') {
            if (j.aids === 'full' || j.aids === 'noCaddy' || j.aids === 'distancesOnly') rules = { kind: 'rules', aids: j.aids, by: String(j.by ?? ''), at: Number(j.at) || 0 };
          } else if (j?.kind === 'live') {
            // Only rounds started in the last 8 hours count as "on now"
            if (typeof j.code === 'string' && Date.now() - Number(j.at) < 8 * 3600 * 1000)
              live.push({ kind: 'live', code: j.code, course: String(j.course ?? ''), scorer: String(j.scorer ?? ''), at: Number(j.at) });
          } else if (j && typeof j.name === 'string' && j.name.trim()) list.push({ name: j.name.trim().slice(0, 40), ga: Number(j.ga) || 0, at: Number(j.at) || 0 });
        } catch {
          /* not one of ours */
        }
      }
      onJoiners(list, live.sort((a, b) => b.at - a.at), rules);
    },
    () => undefined,
  );
}

/**
 * Add any joiners this phone doesn't have as members yet (as friends if
 * they're new to this phone). Returns the names that were added.
 */
export function addJoiners(comp: Competition, joiners: Joiner[]): { comp: Competition; added: string[] } {
  const settings = store.settings();
  const friends = store.friends();
  const members = new Set(comp.memberIds);
  const added: string[] = [];
  for (const j of joiners) {
    const key = personKey(j.name);
    let id = personKey(settings.me.name) === key ? 'me' : friends.find((f) => personKey(f.name) === key)?.id;
    if (!id) {
      const f: Player = { id: uid(), name: j.name, gaHandicap: j.ga };
      friends.push(f);
      store.saveFriend(f);
      id = f.id;
    }
    if (!members.has(id)) {
      members.add(id);
      added.push(j.name);
    }
  }
  if (!added.length) return { comp, added };
  const next = { ...comp, memberIds: [...members] };
  store.saveComp(next);
  return { comp: next, added };
}
