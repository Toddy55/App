import type { HoleCell, LeaderRow } from './scoring';

/**
 * Mates' games, scored from everyone's net score on each hole (handicap
 * strokes applied, so it's fair across handicaps).
 *  - skins: win a hole outright for a skin; ties carry the skin to the next hole
 *  - matchplay: everyone plays everyone, hole by hole: win 1 point, halve ½
 *  - nassau: every pairing is three bets: front 9, back 9 and the 18
 *  - sixes (4 players): partners change every 6 holes (better ball); 1 point per 6-hole match won
 *  - nines (3 players): 9 points a hole, 5-3-1 (ties split)
 */
export type Game = 'skins' | 'matchplay' | 'nassau' | 'sixes' | 'nines';

export const GAME_PLAYERS: Record<Game, [number, number]> = {
  skins: [2, 8],
  matchplay: [2, 4],
  nassau: [2, 4],
  sixes: [4, 4],
  nines: [3, 3],
};

const net = (row: LeaderRow, hole: number) => (row.cells[hole] as HoleCell | undefined)?.net;

/** Hole-by-hole result between two players or teams over some holes: +1 per hole a wins, −1 per hole b wins. */
function holesUp(a: (h: number) => number | undefined, b: (h: number) => number | undefined, holes: number[]): number {
  let up = 0;
  for (const h of holes) {
    const x = a(h);
    const y = b(h);
    if (x == null || y == null) continue;
    if (x < y) up++;
    else if (y < x) up--;
  }
  return up;
}

export interface GameResult {
  points: Map<string, number>;
  /** A few words per player, e.g. "3 skins" or "W2 H1 L0". */
  note: Map<string, string>;
}

/** Points per player for one round (null if the round doesn't suit the game, e.g. Sixes without 4 players). */
export function playGame(game: Game, rows: LeaderRow[], holes: number[]): GameResult | null {
  const [min, max] = GAME_PLAYERS[game];
  if (rows.length < min || rows.length > max) return null;
  const points = new Map(rows.map((r) => [r.id, 0]));
  const note = new Map<string, string>();
  const add = (id: string, n: number) => points.set(id, (points.get(id) ?? 0) + n);

  if (game === 'skins') {
    let carry = 0;
    for (const h of holes) {
      const scores = rows.map((r) => ({ id: r.id, n: net(r, h) })).filter((x): x is { id: string; n: number } => x.n != null);
      if (scores.length < 2) continue;
      const best = Math.min(...scores.map((x) => x.n));
      const winners = scores.filter((x) => x.n === best);
      if (winners.length === 1) {
        add(winners[0].id, 1 + carry);
        carry = 0;
      } else carry++;
    }
    for (const r of rows) note.set(r.id, `${points.get(r.id)} skin${points.get(r.id) === 1 ? '' : 's'}`);
    return { points, note };
  }

  if (game === 'matchplay' || game === 'nassau') {
    const rec = new Map(rows.map((r) => [r.id, { w: 0, h: 0, l: 0 }]));
    const legs = game === 'nassau' && holes.length > 9 ? [holes.slice(0, 9), holes.slice(9), holes] : [holes];
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i];
        const b = rows[j];
        for (const leg of legs) {
          const up = holesUp((h) => net(a, h), (h) => net(b, h), leg);
          if (up > 0) {
            add(a.id, 1);
            rec.get(a.id)!.w++;
            rec.get(b.id)!.l++;
          } else if (up < 0) {
            add(b.id, 1);
            rec.get(b.id)!.w++;
            rec.get(a.id)!.l++;
          } else {
            add(a.id, 0.5);
            add(b.id, 0.5);
            rec.get(a.id)!.h++;
            rec.get(b.id)!.h++;
          }
        }
      }
    }
    for (const [id, x] of rec) note.set(id, `W${x.w} H${x.h} L${x.l}`);
    return { points, note };
  }

  if (game === 'sixes') {
    // In playing order A, B, C, D: AB v CD, then AC v BD, then AD v BC
    const [A, B, C, D] = rows;
    const pairs: [LeaderRow[], LeaderRow[]][] = [
      [[A, B], [C, D]],
      [[A, C], [B, D]],
      [[A, D], [B, C]],
    ];
    const per = Math.ceil(holes.length / 3);
    const ball = (team: LeaderRow[]) => (h: number) => {
      const ns = team.map((r) => net(r, h)).filter((n): n is number => n != null);
      return ns.length ? Math.min(...ns) : undefined;
    };
    pairs.forEach(([t1, t2], k) => {
      const up = holesUp(ball(t1), ball(t2), holes.slice(k * per, (k + 1) * per));
      const win = up > 0 ? t1 : up < 0 ? t2 : null;
      if (win) win.forEach((r) => add(r.id, 1));
      else [...t1, ...t2].forEach((r) => add(r.id, 0.5));
    });
    for (const r of rows) note.set(r.id, `${points.get(r.id)} of 3 matches`);
    return { points, note };
  }

  // nines: 5-3-1 a hole, ties share
  for (const h of holes) {
    const scores = rows.map((r) => ({ id: r.id, n: net(r, h) }));
    if (scores.some((x) => x.n == null)) continue;
    const sorted = [...scores].sort((a, b) => a.n! - b.n!);
    const pts = [5, 3, 1];
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1].n === sorted[i].n) j++;
      const share = pts.slice(i, j + 1).reduce((s, x) => s + x, 0) / (j - i + 1);
      for (let k = i; k <= j; k++) add(sorted[k].id, share);
      i = j + 1;
    }
  }
  for (const r of rows) note.set(r.id, `${points.get(r.id)} pts`);
  return { points, note };
}
