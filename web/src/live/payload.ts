import type { Round } from '../types';
import { store } from '../lib/storage';
import { encodeBundle, makeBundle } from '../lib/share';
import { eligibleRounds } from '../lib/comps';
import { computeResult } from '../lib/scoring';
import type { LiveDoc } from './live';

/** Everything the watchers need: the live round plus the comp rounds so far (for "if it finished now" tables). */
export async function livePayload(round: Round, currentHole: number): Promise<Omit<LiveDoc, 'owner' | 'updatedAt'>> {
  const settings = store.settings();
  const comps = store.comps().filter((c) => round.compIds?.includes(c.id));
  const all = store.rounds();
  const compRounds = new Map<string, Round>();
  for (const c of comps) for (const r of eligibleRounds(c, all)) if (r.id !== round.id) compRounds.set(r.id, r);
  const bundle = makeBundle({ me: settings.me, friends: store.friends(), rounds: [round, ...compRounds.values()], comps });
  return {
    data: await encodeBundle(bundle),
    status: round.completed ? 'final' : 'live',
    hole: currentHole,
    headline: computeResult(round).headline,
    scorer: settings.me.name,
  };
}

export function liveUrl(code: string): string {
  return `${location.origin}${location.pathname}#live=${code}`;
}
