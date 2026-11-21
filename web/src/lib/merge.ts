import type { Competition, Round } from '../types';
import { personKey, type Bundle, type Person } from './share';
import { assignMarkers, sideKeys, type MarkerPhone } from './markers';

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

/**
 * Phones cross-marking the same card send one bundle each. Fold them into one
 * card per group, taking each side's scores from the phone that marks it.
 */
export function foldMarkers(bundles: Bundle[]): Bundle[] {
  const hosts = bundles.filter((b) => !b.rounds[0]?.liveSameAs || !bundles.some((h) => h.rounds[0]?.liveGroup === b.rounds[0]?.liveSameAs));
  return hosts.map((h) => {
    const host = h.rounds[0];
    if (!host?.liveGroup) return h;
    const markers = bundles.filter((b) => b !== h && b.rounds[0]?.liveSameAs === host.liveGroup);
    if (!markers.length) return h;
    const all = [h, ...markers.sort((a, b) => ((a.rounds[0].liveGroup ?? '') < (b.rounds[0].liveGroup ?? '') ? -1 : 1))];
    const phones: MarkerPhone[] = all.map((b) => ({ group: b.rounds[0].liveGroup!, owner: personKey(b.from), name: b.from }));
    const assign = assignMarkers(sideKeys(host), phones);
    if (!assign) return h;
    const scores = { ...host.scores };
    for (const [side, group] of Object.entries(assign)) {
      const from = all.find((b) => b.rounds[0].liveGroup === group)!.rounds[0];
      if (from.scores[side]) scores[side] = from.scores[side];
    }
    const people = new Map(h.people.map((p) => [p.key, p]));
    markers.forEach((m) => m.people.forEach((p) => people.set(p.key, people.get(p.key) ?? p)));
    return { ...h, from: all.map((b) => b.from).join(' & '), people: [...people.values()], rounds: [{ ...host, scores }, ...h.rounds.slice(1)] };
  });
}

/** Combine each group's bundle into one bundle holding the merged field round plus any comp history. */
export function mergeEventBundles(rawBundles: Bundle[], eventId: string): Bundle {
  const bundles = foldMarkers(rawBundles);
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
