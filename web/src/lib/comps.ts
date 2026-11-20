import type { Competition, Round } from '../types';
import { sideRows, sidesFor, type LeaderRow } from './scoring';

export const SCORING_LABELS: Record<Competition['scoring'], string> = {
  league: 'League points (by finishing position)',
  stableford_total: 'Total Stableford points',
  stableford_avg: 'Average Stableford',
  net_avg: 'Average net score',
};

export const SCORING_BLURB: Record<Competition['scoring'], string> = {
  league: 'Each round, players are ranked on Stableford (Ambrose: team net) and get points by position, plus points for turning up.',
  stableford_total: 'Add up everyone\'s Stableford points. Rewards turning up, so pair it with "best N rounds" to keep it fair.',
  stableford_avg: 'Average Stableford per round. Fair when people play different numbers of rounds.',
  net_avg: 'Average net score per round, lowest wins. Best for 18-hole stroke rounds.',
};

export const COMP_PRESETS: { label: string; make: () => Partial<Competition> }[] = [
  {
    label: 'Friday Arvo League',
    make: () => ({ name: 'Friday Arvo League', scoring: 'league', pointsTable: [10, 8, 6, 5, 4, 3, 2, 1], participationPoints: 1, birdieBonus: 1, countBest: 10 }),
  },
  {
    label: 'Stableford Shootout',
    make: () => ({ name: 'Stableford Shootout', scoring: 'stableford_total', countBest: 8, roundLimit: 12, pointsTable: [], participationPoints: 0, birdieBonus: 0 }),
  },
  {
    label: 'Order of Merit',
    make: () => ({ name: 'Order of Merit', scoring: 'stableford_avg', minRounds: 3, pointsTable: [], participationPoints: 0, birdieBonus: 0 }),
  },
];

export function newComp(id: string, memberIds: string[], partial: Partial<Competition> = {}): Competition {
  return {
    id,
    name: 'New comp',
    memberIds,
    start: localDate(new Date()),
    scoring: 'league',
    pointsTable: [10, 8, 6, 5, 4, 3, 2, 1],
    participationPoints: 1,
    birdieBonus: 0,
    minPlayers: 2,
    minRounds: 3,
    holes: 'any',
    createdAt: Date.now(),
    ...partial,
  };
}

/** yyyy-mm-dd in the device's local time zone. */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const roundDay = (r: Round) => localDate(new Date(r.date));

export interface Entry {
  playerId: string;
  name: string;
  /** Stableford points for individual rounds, team net for Ambrose. */
  stableford?: number;
  net?: number;
  gross: number;
  position: number;
  /** League points earned in this round (position + participation + bonus). */
  points: number;
  birdies: number;
  teamName?: string;
}

export interface CompRound {
  round: Round;
  entries: Entry[];
}

export interface Standing {
  playerId: string;
  name: string;
  played: number;
  counted: number;
  /** Headline number for the table: points, total, or average. */
  value: number;
  wins: number;
  podiums: number;
  bestStableford?: number;
  bestNet?: number;
  birdies: number;
  /** Positions in the most recent rounds, oldest first (max 5). */
  form: number[];
  qualified: boolean;
  rank: number;
}

export interface CompResult {
  rounds: CompRound[];
  standings: Standing[];
  status: 'upcoming' | 'active' | 'complete';
  /** Rounds left when the comp has a round limit. */
  remaining?: number;
  /** Lower value is better (net average). */
  lowerIsBetter: boolean;
}

function isComplete(row: LeaderRow, round: Round) {
  const n = round.scoreHoles ? round.scoreHoles.length : round.holes.length;
  return row.thru === n && n > 0;
}

/** Score one round for the comp: rank members who played and award league points. */
export function scoreRound(comp: Competition, round: Round, nameOf: (id: string) => string): CompRound | null {
  const members = new Set(comp.memberIds);
  const entries: Entry[] = [];
  if (round.format === 'ambrose') {
    const teamRows = sideRows(round, sidesFor(round));
    for (const t of round.teams ?? []) {
      const row = teamRows.find((r) => r.id === t.id);
      if (!row || !isComplete(row, round)) continue;
      for (const pid of t.playerIds) {
        if (!members.has(pid)) continue;
        entries.push({ playerId: pid, name: nameOf(pid), net: row.net, gross: row.gross, position: 0, points: 0, birdies: 0, teamName: t.name });
      }
    }
  } else {
    const rows = sideRows(round, round.players.map((p) => ({ id: p.id, name: p.name, handicap: p.playingHandicap, memberIds: [p.id] })));
    for (const row of rows) {
      if (!members.has(row.id) || !isComplete(row, round)) continue;
      const birdies = round.holes.filter((h) => (row.cells[h.number]?.gross ?? 99) < h.par).length;
      entries.push({ playerId: row.id, name: nameOf(row.id), stableford: row.points, net: row.net, gross: row.gross, position: 0, points: 0, birdies });
    }
  }
  if (entries.length < Math.max(1, comp.minPlayers)) return null;

  // Rank: Stableford high-to-low, or team net low-to-high for Ambrose
  const key = (e: Entry) => (round.format === 'ambrose' ? e.net! : -(e.stableford ?? 0));
  const sorted = [...entries].sort((a, b) => key(a) - key(b));
  // Ambrose team-mates share one position; ties share the average of the points on offer
  const groups: Entry[][] = [];
  for (const e of sorted) {
    const g = groups[groups.length - 1];
    if (g && key(g[0]) === key(e)) g.push(e);
    else groups.push([e]);
  }
  let place = 1;
  for (const g of groups) {
    const slots = round.format === 'ambrose' ? new Set(g.map((e) => e.teamName)).size : g.length;
    const pts = Array.from({ length: slots }, (_, i) => comp.pointsTable[place - 1 + i] ?? 0);
    const share = Math.round((pts.reduce((a, b) => a + b, 0) / slots) * 10) / 10;
    for (const e of g) {
      e.position = place;
      e.points = share + comp.participationPoints + e.birdies * comp.birdieBonus;
    }
    place += slots;
  }
  return { round, entries: sorted };
}

export function eligibleRounds(comp: Competition, rounds: Round[]): Round[] {
  return rounds
    .filter((r) => r.completed && r.compIds?.includes(comp.id))
    .filter((r) => {
      const d = roundDay(r);
      return d >= comp.start && (!comp.end || d <= comp.end);
    })
    .filter((r) => comp.holes === 'any' || (comp.holes === '18' ? r.holes.length >= 18 : r.holes.length <= 9))
    .sort((a, b) => a.startedAt - b.startedAt);
}

export function computeComp(comp: Competition, rounds: Round[], nameOf: (id: string) => string, today = localDate(new Date())): CompResult {
  const lowerIsBetter = comp.scoring === 'net_avg';
  let scored = eligibleRounds(comp, rounds)
    .filter((r) => !(comp.scoring !== 'league' && r.format === 'ambrose')) // Ambrose has no individual score
    .map((r) => scoreRound(comp, r, nameOf))
    .filter((x): x is CompRound => !!x);
  if (comp.roundLimit) scored = scored.slice(0, comp.roundLimit);

  const standings: Standing[] = comp.memberIds.map((id) => {
    const mine = scored.map((cr) => cr.entries.find((e) => e.playerId === id)).filter((e): e is Entry => !!e);
    const metric = (e: Entry) =>
      comp.scoring === 'league' ? e.points : comp.scoring === 'net_avg' ? (e.net ?? 0) : (e.stableford ?? 0);
    let counted = mine.map(metric);
    if (comp.countBest && counted.length > comp.countBest) {
      counted = [...counted].sort((a, b) => (lowerIsBetter ? a - b : b - a)).slice(0, comp.countBest);
    }
    const sum = counted.reduce((a, b) => a + b, 0);
    const isAvg = comp.scoring === 'stableford_avg' || comp.scoring === 'net_avg';
    const value = isAvg ? (counted.length ? Math.round((sum / counted.length) * 10) / 10 : 0) : Math.round(sum * 10) / 10;
    const stbs = mine.map((e) => e.stableford).filter((n): n is number => n != null);
    const nets = mine.map((e) => e.net).filter((n): n is number => n != null);
    return {
      playerId: id,
      name: nameOf(id),
      played: mine.length,
      counted: counted.length,
      value,
      wins: mine.filter((e) => e.position === 1).length,
      podiums: mine.filter((e) => e.position <= 3).length,
      bestStableford: stbs.length ? Math.max(...stbs) : undefined,
      bestNet: nets.length ? Math.min(...nets) : undefined,
      birdies: mine.reduce((s, e) => s + e.birdies, 0),
      form: mine.slice(-5).map((e) => e.position),
      qualified: isAvg ? mine.length >= comp.minRounds : true,
      rank: 0,
    };
  });

  standings.sort((a, b) => {
    if (a.qualified !== b.qualified) return a.qualified ? -1 : 1;
    if (a.played === 0 || b.played === 0) return b.played - a.played;
    const d = lowerIsBetter ? a.value - b.value : b.value - a.value;
    return d || b.wins - a.wins || a.name.localeCompare(b.name);
  });
  let rank = 0;
  standings.forEach((s, i) => {
    const prev = standings[i - 1];
    if (!prev || prev.value !== s.value || prev.qualified !== s.qualified || prev.wins !== s.wins) rank = i + 1;
    s.rank = s.played ? rank : 0;
  });

  const limitReached = !!comp.roundLimit && scored.length >= comp.roundLimit;
  const status: CompResult['status'] =
    today < comp.start ? 'upcoming' : limitReached || (comp.end && today > comp.end) ? 'complete' : 'active';
  return {
    rounds: scored,
    standings,
    status,
    remaining: comp.roundLimit ? Math.max(0, comp.roundLimit - scored.length) : undefined,
    lowerIsBetter,
  };
}

/** Comps a new round should count towards by default. */
export function suggestedComps(comps: Competition[], playerIds: string[], today = localDate(new Date())): string[] {
  return comps
    .filter((c) => c.start <= today && (!c.end || c.end >= today))
    .filter((c) => playerIds.filter((id) => c.memberIds.includes(id)).length >= Math.max(1, c.minPlayers))
    .map((c) => c.id);
}

export function valueLabel(comp: Competition, s: Standing): string {
  switch (comp.scoring) {
    case 'league':
      return `${s.value} pts`;
    case 'stableford_total':
      return `${s.value} pts`;
    case 'stableford_avg':
      return `${s.value} avg`;
    case 'net_avg':
      return `${s.value} net`;
  }
}

/** Plain-text table for pasting in the group chat. */
export function standingsText(comp: Competition, res: CompResult): string {
  const lines = [`🏆 ${comp.name}: after ${res.rounds.length} round${res.rounds.length === 1 ? '' : 's'}${res.remaining != null ? ` (${res.remaining} to go)` : ''}`];
  for (const s of res.standings) {
    if (!s.played) continue;
    const medal = s.rank === 1 ? '🥇' : s.rank === 2 ? '🥈' : s.rank === 3 ? '🥉' : `${s.rank}.`;
    lines.push(`${medal} ${s.name}: ${valueLabel(comp, s)} (${s.played} rd${s.played === 1 ? '' : 's'}, ${s.wins} win${s.wins === 1 ? '' : 's'})${s.qualified ? '' : ' (not qualified yet)'}`);
  }
  const last = res.rounds[res.rounds.length - 1];
  if (last) {
    const w = last.entries.filter((e) => e.position === 1).map((e) => e.name);
    lines.push(`Last round: ${last.round.courseName}, won by ${[...new Set(w)].join(' & ')}`);
  }
  return lines.join('\n');
}

export interface HeadToHead {
  rounds: number;
  wins: number;
  losses: number;
  halves: number;
  myAvg?: number;
  theirAvg?: number;
}

/** Head-to-head on Stableford across every individual round you've both finished. */
export function headToHead(rounds: Round[], a: string, b: string): HeadToHead {
  const out: HeadToHead = { rounds: 0, wins: 0, losses: 0, halves: 0 };
  let sa = 0,
    sb = 0;
  for (const r of rounds) {
    if (!r.completed || r.format === 'ambrose') continue;
    const pa = r.players.find((p) => p.id === a);
    const pb = r.players.find((p) => p.id === b);
    if (!pa || !pb) continue;
    const rows = sideRows(r, [pa, pb].map((p) => ({ id: p.id, name: p.name, handicap: p.playingHandicap, memberIds: [p.id] })));
    const [ra, rb] = rows;
    if (!isComplete(ra, r) || !isComplete(rb, r)) continue;
    out.rounds++;
    sa += ra.points;
    sb += rb.points;
    if (ra.points > rb.points) out.wins++;
    else if (ra.points < rb.points) out.losses++;
    else out.halves++;
  }
  if (out.rounds) {
    out.myAvg = Math.round((sa / out.rounds) * 10) / 10;
    out.theirAvg = Math.round((sb / out.rounds) * 10) / 10;
  }
  return out;
}
