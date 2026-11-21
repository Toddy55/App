import type { Format, Hole, Round } from '../types';
import { stablefordPoints, strokesByHole } from './handicap';

export const FORMAT_LABELS: Record<Format, string> = {
  stroke: 'Stroke (gross & net)',
  stableford: 'Stableford',
  par: 'Par (v. par)',
  matchplay: 'Match play',
  fourball: '4BBB Stableford (better ball)',
  ambrose: 'Ambrose',
  skins: 'Skins',
};

export const FORMAT_BLURB: Record<Format, string> = {
  stroke: 'Count every shot. Net = gross minus playing handicap.',
  stableford: '2 points for a net par, 1 per shot better, 0 for net double or worse.',
  par: 'Each hole won (+), halved (0) or lost (−) against net par.',
  matchplay: 'Head-to-head, hole by hole. 2 players singles, or 2 pairs better-ball.',
  fourball: 'Pairs: best Stableford score of the two counts on each hole.',
  ambrose: 'Team picks the best shot each time. Team handicap = combined ÷ (2 × team size).',
  skins: 'Win a hole outright to take the skin. Ties carry over.',
};

export interface Side {
  id: string;
  name: string;
  /** Playing handicap (fractional for Ambrose). */
  handicap: number;
  memberIds: string[];
}

export function sidesFor(round: Round): Side[] {
  if (round.format === 'ambrose') {
    return (round.teams ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      handicap: t.handicap,
      memberIds: t.playerIds,
    }));
  }
  return round.players.map((p) => ({
    id: p.id,
    name: p.name,
    handicap: p.playingHandicap,
    memberIds: [p.id],
  }));
}

export interface HoleCell {
  gross?: number;
  strokes: number;
  net?: number;
  points?: number;
  parResult?: -1 | 0 | 1;
}

export interface LeaderRow {
  id: string;
  name: string;
  handicap: number;
  thru: number;
  gross: number;
  grossToPar: number;
  net: number;
  netToPar: number;
  points: number;
  parScore: number;
  skins: number;
  cells: Record<number, HoleCell>;
}

export interface Result {
  rows: LeaderRow[];
  /** Headline per format, e.g. "Toddy 2 up thru 12". */
  headline: string;
  matchStatus?: string;
  skinsByHole?: Record<number, { winner?: string; value: number }>;
  teamRows?: { id: string; name: string; points: number; thru: number }[];
}

function parOf(holes: Hole[], n: number) {
  return holes.find((h) => h.number === n)?.par ?? 4;
}

export function sideRows(round: Round, sides: Side[]): LeaderRow[] {
  return sides.map((side) => {
    const isAmbrose = round.format === 'ambrose';
    // Ambrose handicap comes off the total, not hole by hole.
    const alloc = isAmbrose ? {} : strokesByHole(side.handicap, round.holes);
    const scores = round.scores[side.id] ?? {};
    const cells: Record<number, HoleCell> = {};
    let thru = 0,
      gross = 0,
      parPlayed = 0,
      net = 0,
      points = 0,
      parScore = 0;
    const only = round.scoreHoles ? new Set(round.scoreHoles) : null;
    for (const hole of round.holes) {
      const g = only && !only.has(hole.number) ? undefined : scores[hole.number];
      const strokes = (alloc as Record<number, number>)[hole.number] ?? 0;
      if (g == null || g <= 0) {
        cells[hole.number] = { strokes };
        continue;
      }
      const n = g - strokes;
      const pts = stablefordPoints(g, hole.par, strokes);
      const pr: -1 | 0 | 1 = n < hole.par ? 1 : n === hole.par ? 0 : -1;
      cells[hole.number] = { gross: g, strokes, net: n, points: pts, parResult: pr };
      thru++;
      gross += g;
      parPlayed += hole.par;
      net += n;
      points += pts;
      parScore += pr;
    }
    if (isAmbrose) {
      // The team handicap is for the whole round, so mid-round only the
      // share for the holes played comes off (e.g. half of it after 9)
      const share = round.holes.length ? thru / round.holes.length : 1;
      net = Math.round((gross - side.handicap * share) * 10) / 10;
    }
    return {
      id: side.id,
      name: side.name,
      handicap: side.handicap,
      thru,
      gross,
      grossToPar: gross - parPlayed,
      net,
      netToPar: Math.round((net - parPlayed) * 10) / 10,
      points,
      parScore,
      skins: 0,
      cells,
    };
  });
}

export function toParLabel(n: number): string {
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : `${n}`;
}

export function computeResult(round: Round): Result {
  const sides = sidesFor(round);
  const rows = sideRows(round, sides);
  switch (round.format) {
    case 'stroke': {
      // Rank on net to par so groups that have played different numbers of holes compare fairly
      rows.sort((a, b) => a.netToPar - b.netToPar || a.grossToPar - b.grossToPar);
      return { rows, headline: netHeadline(round, rows) };
    }
    case 'stableford': {
      rows.sort((a, b) => b.points - a.points);
      const l = rows[0];
      return { rows, headline: l ? `${l.name} leads with ${l.points} pts` : '' };
    }
    case 'par': {
      rows.sort((a, b) => b.parScore - a.parScore);
      const l = rows[0];
      return { rows, headline: l ? `${l.name} ${parLabel(l.parScore)}` : '' };
    }
    case 'ambrose': {
      rows.sort((a, b) => a.netToPar - b.netToPar || a.grossToPar - b.grossToPar);
      return { rows, headline: netHeadline(round, rows) };
    }
    case 'skins':
      return skins(round, rows);
    case 'fourball':
      return fourball(round, rows);
    case 'matchplay':
      return matchplay(round, rows);
  }
}

/** "Team A leads at 2 under net thru 9", or the final net score once everyone's done. */
function netHeadline(round: Round, rows: LeaderRow[]): string {
  const played = rows.filter((r) => r.thru > 0);
  const l = played[0];
  if (!l) return rows[0] ? `${rows[0].name} to tee off` : '';
  const holes = round.scoreHoles?.length ?? round.holes.length;
  const done = played.length === rows.length && rows.every((r) => r.thru >= holes);
  const toPar = netToParWords(l.netToPar);
  if (done) return `${l.name} ${round.completed ? 'wins' : 'leads'} on net ${l.net} (${toParLabel(l.netToPar)})`;
  return `${l.name} lead${/ & /.test(l.name) ? '' : 's'} at ${toPar} net thru ${l.thru}`;
}

function netToParWords(n: number): string {
  const v = Math.abs(Math.round(n * 10) / 10);
  if (v === 0) return 'level';
  return `${v} ${n < 0 ? 'under' : 'over'}`;
}

export function parLabel(n: number): string {
  if (n === 0) return 'square';
  return n > 0 ? `${n} up` : `${-n} down`;
}

function skins(round: Round, rows: LeaderRow[]): Result {
  const byHole: Record<number, { winner?: string; value: number }> = {};
  let carry = 0;
  const totals: Record<string, number> = {};
  for (const hole of round.holes) {
    const entries = rows
      .map((r) => ({ r, c: r.cells[hole.number] }))
      .filter((e) => e.c.gross != null);
    if (entries.length < rows.length || rows.length === 0) break; // hole not finished by all
    const val = (e: (typeof entries)[number]) => (round.options.skinsNet ? e.c.net! : e.c.gross!);
    const best = Math.min(...entries.map(val));
    const winners = entries.filter((e) => val(e) === best);
    const value = 1 + carry;
    if (winners.length === 1) {
      const w = winners[0].r;
      totals[w.id] = (totals[w.id] ?? 0) + value;
      byHole[hole.number] = { winner: w.name, value };
      carry = 0;
    } else {
      byHole[hole.number] = { value };
      carry = round.options.skinsCarryOver ? value : 0;
    }
  }
  rows.forEach((r) => (r.skins = totals[r.id] ?? 0));
  rows.sort((a, b) => b.skins - a.skins);
  const l = rows[0];
  return {
    rows,
    skinsByHole: byHole,
    headline: l
      ? `${l.name} has ${l.skins} skin${l.skins === 1 ? '' : 's'}${carry ? ` · ${carry} carrying` : ''}`
      : '',
  };
}

function fourball(round: Round, rows: LeaderRow[]): Result {
  const teams = round.teams ?? [];
  const teamRows = teams.map((t) => {
    let points = 0;
    let thru = 0;
    for (const hole of round.holes) {
      const pts = rows
        .filter((r) => t.playerIds.includes(r.id))
        .map((r) => r.cells[hole.number])
        .filter((c) => c.gross != null)
        .map((c) => c.points ?? 0);
      if (pts.length) {
        points += Math.max(...pts);
        thru++;
      }
    }
    return { id: t.id, name: t.name, points, thru };
  });
  teamRows.sort((a, b) => b.points - a.points);
  rows.sort((a, b) => b.points - a.points);
  const l = teamRows[0];
  return { rows, teamRows, headline: l ? `${l.name} lead with ${l.points} pts` : '' };
}

function matchplay(round: Round, rows: LeaderRow[]): Result {
  // Singles (2 players) or better-ball (2 teams of 2).
  type Party = { name: string; ids: string[] };
  let parties: Party[];
  if (round.teams && round.teams.length === 2) {
    parties = round.teams.map((t) => ({ name: t.name, ids: t.playerIds }));
  } else {
    parties = round.players.slice(0, 2).map((p) => ({ name: p.name, ids: [p.id] }));
  }
  if (parties.length < 2) return { rows, headline: 'Need two players or two pairs' };

  // Strokes off the low marker: everyone receives the difference to the lowest handicap.
  const low = Math.min(...round.players.map((p) => p.playingHandicap));
  const allocs: Record<string, Record<number, number>> = {};
  for (const p of round.players) allocs[p.id] = strokesByHole(p.playingHandicap - low, round.holes);

  let diff = 0; // + means party 0 is up
  let played = 0;
  let finished: string | undefined;
  const total = round.holes.length;
  for (const hole of round.holes) {
    const best = parties.map((party) => {
      const nets = party.ids
        .map((id) => {
          const g = round.scores[id]?.[hole.number];
          return g ? g - (allocs[id]?.[hole.number] ?? 0) : undefined;
        })
        .filter((n): n is number => n != null);
      return nets.length ? Math.min(...nets) : undefined;
    });
    if (best[0] == null || best[1] == null) break;
    played++;
    if (best[0] < best[1]) diff++;
    else if (best[1] < best[0]) diff--;
    const remaining = total - played;
    if (Math.abs(diff) > remaining) {
      const w = diff > 0 ? parties[0].name : parties[1].name;
      finished = remaining === 0 ? `${w} wins ${Math.abs(diff)} up` : `${w} wins ${Math.abs(diff)}&${remaining}`;
      break;
    }
  }
  const remaining = total - played;
  let status: string;
  if (finished) status = finished;
  else if (played === 0) status = 'All square, match about to start';
  else if (diff === 0) status = remaining === 0 ? 'Match halved' : `All square thru ${played}`;
  else {
    const leader = diff > 0 ? parties[0].name : parties[1].name;
    status = `${leader} ${Math.abs(diff)} up thru ${played}${Math.abs(diff) === remaining ? ' (dormie)' : ''}`;
  }
  return { rows, headline: status, matchStatus: status };
}

export function holeParTotal(holes: Hole[]): number {
  return holes.reduce((s, h) => s + h.par, 0);
}

export { parOf };
