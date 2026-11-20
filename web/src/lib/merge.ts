import type { Competition, Round } from '../types';
import type { Bundle, Person } from './share';

/**
 * Merge the separate group cards of one live event (e.g. two four-balls on a
 * Friday) into a single round for the whole field, so the leaderboard and comp
 * positions rank everyone together.
 */
export function mergeGroupRounds(rounds: Round[], eventId: string): Round {
  if (rounds.length === 0) throw new Error('nothing to merge');
  const sorted = [...rounds].sort((a, b) => a.startedAt - b.startedAt);
  const base = sorted[0];
  const players: Round['players'] = [];
  const teams: NonNullable<Round['teams']> = [];
  const scores: Round['scores'] = {};
  const compIds = new Set<string>();
  sorted.forEach((r, gi) => {
    const teamIds = new Map((r.teams ?? []).map((t) => [t.id, sorted.length > 1 ? `g${gi + 1}-${t.id}` : t.id]));
    for (const p of r.players) {
      if (players.some((x) => x.id === p.id)) continue; // same person can't be in two groups
      players.push({ ...p, teamId: p.teamId ? teamIds.get(p.teamId) : undefined });
    }
    for (const t of r.teams ?? []) teams.push({ ...t, id: teamIds.get(t.id)! });
    for (const [side, s] of Object.entries(r.scores)) scores[teamIds.get(side) ?? side] = { ...(scores[teamIds.get(side) ?? side] ?? {}), ...s };
    r.compIds?.forEach((c) => compIds.add(c));
  });
  return {
    ...base,
    id: `ev-${eventId}`,
    players,
    teams: teams.length ? teams : undefined,
    scores,
    stats: {},
    shots: {},
    pins: {},
    compIds: [...compIds],
    liveCode: eventId,
    liveGroup: undefined,
    completed: sorted.every((r) => r.completed),
    startedAt: base.startedAt,
  };
}

/** Combine each group's bundle into one bundle holding the merged field round plus any comp history. */
export function mergeEventBundles(bundles: Bundle[], eventId: string): Bundle {
  const people = new Map<string, Person>();
  const comps = new Map<string, Competition>();
  const history = new Map<string, Round>();
  const live: Round[] = [];
  for (const b of bundles) {
    b.people.forEach((p) => people.set(p.key, p));
    b.comps.forEach((c) => {
      const prev = comps.get(c.id);
      comps.set(c.id, prev ? { ...c, memberIds: [...new Set([...prev.memberIds, ...c.memberIds])] } : c);
    });
    const [groupRound, ...rest] = b.rounds;
    if (groupRound) live.push(groupRound);
    rest.forEach((r) => history.set(r.id, r));
  }
  const merged = mergeGroupRounds(live, eventId);
  return {
    v: 1,
    from: bundles.map((b) => b.from).join(' & '),
    people: [...people.values()],
    rounds: [merged, ...[...history.values()].filter((r) => r.id !== merged.id && r.liveCode !== eventId)],
    comps: [...comps.values()],
  };
}
