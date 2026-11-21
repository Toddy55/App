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
  const mate: CrewMate = { name: me.name, ga: me.gaHandicap, gaNo: me.gaNumber, src: me.hcpSource, at: Date.now() };
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
      for (const d of Object.values(docs ?? {})) {
        try {
          const m = JSON.parse(d.data) as CrewMate;
          const name = String(m.name ?? '').trim().slice(0, 40);
          if (!name) continue;
          const key = personKey(name);
          if (key === personKey(me.name) || friends.some((f) => personKey(f.name) === key)) continue;
          const f: Player = {
            id: uid(),
            name,
            gaHandicap: Number(m.ga) || 0,
            ...(m.gaNo ? { gaNumber: String(m.gaNo) } : {}),
            ...(m.src === 'manual' || m.src === 'ga' ? { hcpSource: m.src } : {}),
          };
          store.saveFriend(f);
          friends.push(f);
          added.push(name);
        } catch {
          /* skip */
        }
      }
      if (added.length) onAdded(added);
    },
    () => undefined,
  );
}
