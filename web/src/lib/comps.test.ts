import { describe, expect, it } from 'vitest';
import type { Round, RoundPlayer } from '../types';
import { blankHoles } from './courses';
import { computeComp, headToHead, newComp, standingsText, suggestedComps } from './comps';
import { applyBundle, autoMap, decodeBundle, encodeBundle, makeBundle } from './share';

const holes = blankHoles(18);
const P = (id: string, name: string, h: number): RoundPlayer => ({ id, name, gaHandicap: h, dailyHandicap: h, playingHandicap: h });
const names: Record<string, string> = { me: 'Toddy', d: 'Dazza', s: 'Shazza', b: 'Bazza' };
const nameOf = (id: string) => names[id] ?? id;

/** Every player shoots par + `over` on each hole (so Stableford = 36 + handicap − 18·over). */
function round(id: string, date: string, players: RoundPlayer[], over: Record<string, number>, extra: Partial<Round> = {}): Round {
  const scores: Round['scores'] = {};
  for (const p of players) scores[p.id] = Object.fromEntries(holes.map((h) => [h.number, h.par + (over[p.id] ?? 0)]));
  return {
    id,
    courseId: 'c',
    courseName: 'Black Bull',
    date: `${date}T05:00:00.000Z`,
    format: 'stableford',
    holes,
    players,
    meId: 'me',
    scores,
    stats: {},
    shots: {},
    pins: {},
    options: { allowance: 100, skinsNet: false, skinsCarryOver: true },
    completed: true,
    compIds: ['friday'],
    startedAt: Date.parse(date),
    ...extra,
  };
}

const crew = [P('me', 'Toddy', 18), P('d', 'Dazza', 18), P('s', 'Shazza', 18)];

describe('league comp', () => {
  const comp = newComp('friday', ['me', 'd', 's', 'b'], { start: '2026-11-01', pointsTable: [10, 8, 6], participationPoints: 1 });
  const rounds = [
    round('r1', '2026-11-06', crew, { me: 0, d: 1, s: 2 }), // Toddy 54, Dazza 36, Shazza 18
    round('r2', '2026-11-13', crew, { me: 1, d: 0, s: 1 }), // Dazza wins, Toddy & Shazza tie 2nd
    round('r3', '2026-10-30', crew, { me: 0, d: 0, s: 0 }), // before start: ignored
    round('r4', '2026-11-14', crew, { me: 0, d: 0, s: 0 }, { compIds: [] }), // not tagged: ignored
  ];
  const res = computeComp(comp, rounds, nameOf, '2026-11-20');

  it('counts only tagged rounds inside the dates', () => {
    expect(res.rounds.map((r) => r.round.id)).toEqual(['r1', 'r2']);
  });
  it('awards position points, shares ties and adds participation', () => {
    const by = Object.fromEntries(res.standings.map((s) => [s.playerId, s]));
    // r1: Toddy 10+1, Dazza 8+1, Shazza 6+1. r2: Dazza 10+1, Toddy/Shazza (8+6)/2 = 7 +1
    expect(by.me.value).toBe(19);
    expect(by.d.value).toBe(20);
    expect(by.s.value).toBe(15);
    expect(by.b.played).toBe(0);
    expect(res.standings[0].playerId).toBe('d');
    expect(by.me.wins).toBe(1);
  });
  it('formats a table for the group chat', () => {
    const t = standingsText(comp, res);
    expect(t).toContain('🥇 Dazza: 20 pts');
    expect(t).not.toContain('Bazza');
  });
  it('stops at the round limit and uses best N', () => {
    const limited = computeComp({ ...comp, roundLimit: 1 }, rounds, nameOf, '2026-11-20');
    expect(limited.rounds.length).toBe(1);
    expect(limited.status).toBe('complete');
    const best = computeComp({ ...comp, countBest: 1 }, rounds, nameOf, '2026-11-20');
    expect(best.standings.find((s) => s.playerId === 'me')!.value).toBe(11);
  });
  it('needs the minimum number of members', () => {
    const solo = round('r5', '2026-11-15', [P('me', 'Toddy', 18)], { me: 0 });
    const r = computeComp(comp, [solo], nameOf, '2026-11-20');
    expect(r.rounds.length).toBe(0);
  });
});

describe('average comps', () => {
  it('ranks qualified players first for averages', () => {
    const comp = newComp('friday', ['me', 'd'], { scoring: 'stableford_avg', start: '2026-11-01', minRounds: 2, minPlayers: 1 });
    const rounds = [
      round('a', '2026-11-02', crew.slice(0, 2), { me: 1, d: 0 }), // Toddy 36, Dazza 54
      round('b', '2026-11-03', [crew[0], P('s', 'Shazza', 18)], { me: 1 }),
    ];
    const res = computeComp(comp, rounds, nameOf, '2026-11-20');
    expect(res.standings[0].playerId).toBe('me'); // 2 rounds, qualified
    expect(res.standings[1].qualified).toBe(false);
  });
});

describe('ambrose in a league', () => {
  it('team-mates share the team position', () => {
    const comp = newComp('friday', ['me', 'd', 's', 'b'], { start: '2026-11-01', pointsTable: [10, 8], participationPoints: 0, minPlayers: 2 });
    const players = [P('me', 'Toddy', 10), P('d', 'Dazza', 10), P('s', 'Shazza', 10), P('b', 'Bazza', 10)];
    const r = round('amb', '2026-11-06', players, {}, {
      format: 'ambrose',
      teams: [
        { id: 't1', name: 'T1', playerIds: ['me', 'd'], handicap: 5 },
        { id: 't2', name: 'T2', playerIds: ['s', 'b'], handicap: 5 },
      ],
      meId: 't1',
      scores: {
        t1: Object.fromEntries(holes.map((h) => [h.number, h.par - (h.number === 1 ? 1 : 0)])),
        t2: Object.fromEntries(holes.map((h) => [h.number, h.par])),
      },
    });
    const res = computeComp(comp, [r], nameOf, '2026-11-20');
    const by = Object.fromEntries(res.standings.map((s) => [s.playerId, s.value]));
    expect(by).toEqual({ me: 10, d: 10, s: 8, b: 8 });
  });
});

describe('helpers', () => {
  it('suggests active comps with enough members playing', () => {
    const c = newComp('x', ['me', 'd'], { start: '2026-01-01' });
    expect(suggestedComps([c], ['me', 'd'], '2026-11-20')).toEqual(['x']);
    expect(suggestedComps([c], ['me', 's'], '2026-11-20')).toEqual([]);
  });
  it('head to head on stableford', () => {
    const h = headToHead([round('a', '2026-11-02', crew, { me: 0, d: 1 }), round('b', '2026-11-03', crew, { me: 1, d: 1 })], 'me', 'd');
    expect(h).toMatchObject({ rounds: 2, wins: 1, losses: 0, halves: 1 });
  });
});

describe('sharing between phones', () => {
  it('round-trips a round and maps players by name', async () => {
    const me = { id: 'me', name: 'Toddy', gaHandicap: 18 };
    const friends = [{ id: 'd', name: 'Dazza', gaHandicap: 18 }, { id: 's', name: 'Shazza', gaHandicap: 18 }];
    const r = round('r1', '2026-11-06', crew, { me: 0, d: 1, s: 2 }, { stats: { 1: { putts: 2 } } });
    const comp = newComp('friday', ['me', 'd', 's'], { start: '2026-11-01' });
    const bundle = makeBundle({ me, friends, rounds: [r], comps: [comp] });
    const decoded = await decodeBundle(await encodeBundle(bundle));
    expect(decoded.people.map((p) => p.name).sort()).toEqual(['Dazza', 'Shazza', 'Toddy']);

    // Dazza's phone: Dazza is "me", Toddy is a friend with a different id, Shazza is unknown
    const dMe = { id: 'me', name: 'Dazza', gaHandicap: 18 };
    const dFriends = [{ id: 'x1', name: 'toddy', gaHandicap: 18 }];
    const mapping = autoMap(decoded, dMe, dFriends);
    expect(mapping).toEqual({ 'p:toddy': 'x1', 'p:dazza': 'me', 'p:shazza': 'new' });
    let n = 0;
    const plan = applyBundle(decoded, mapping, () => `new${++n}`);
    expect(plan.newFriends).toEqual([{ id: 'new1', name: 'Shazza', gaHandicap: 18 }]);
    const lr = plan.rounds[0];
    expect(lr.players.map((p) => p.id)).toEqual(['x1', 'me', 'new1']);
    expect(lr.meId).toBe('me');
    expect(lr.stats).toEqual({}); // Toddy's putts aren't Dazza's
    expect(lr.scores.me[1]).toBe(5); // Dazza's own score on hole 1 (par 4 + 1)
    expect(plan.comps[0].memberIds).toEqual(['x1', 'me', 'new1']);
    // same comp id on both phones, so the shared round counts
    const res = computeComp(plan.comps[0], plan.rounds, (id) => id, '2026-11-20');
    expect(res.rounds.length).toBe(1);
  });
});
