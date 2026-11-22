import { describe, expect, it } from 'vitest';
import type { LeaderRow } from './scoring';
import { playGame } from './compGames';

// Net scores per hole for each player
const row = (id: string, nets: number[]): LeaderRow =>
  ({ id, name: id, handicap: 0, thru: nets.length, gross: 0, grossToPar: 0, net: 0, netToPar: 0, points: 0, parScore: 0, skins: 0, cells: Object.fromEntries(nets.map((n, i) => [i + 1, { net: n, gross: n, strokes: 0 }])) }) as unknown as LeaderRow;
const holes = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('mates games', () => {
  it('skins: ties carry over', () => {
    // Hole 1 tied (carry), hole 2 Toddy wins 2 skins, hole 3 Jarrod wins 1
    const r = playGame('skins', [row('Toddy', [4, 3, 5]), row('Jarrod', [4, 4, 4])], holes(3))!;
    expect(r.points.get('Toddy')).toBe(2);
    expect(r.points.get('Jarrod')).toBe(1);
    expect(r.note.get('Toddy')).toBe('2 skins');
  });
  it('match play: everyone plays everyone', () => {
    const r = playGame('matchplay', [row('A', [3, 3, 3]), row('B', [4, 4, 4]), row('C', [4, 4, 4])], holes(3))!;
    expect(r.points.get('A')).toBe(2); // beat B and C
    expect(r.points.get('B')).toBe(0.5); // halved with C
    expect(r.note.get('B')).toBe('W0 H1 L1');
  });
  it('nassau: front, back and overall', () => {
    // A wins the front 9 (9 up), B wins the back 9 (4 up): A also takes the 18
    const a = [...Array(9).fill(4), ...Array(9).fill(5)];
    const b = [...Array(9).fill(5), ...Array(4).fill(3), ...Array(5).fill(5)];
    const r = playGame('nassau', [row('A', a), row('B', b)], holes(18))!;
    expect(r.points.get('A')).toBe(2);
    expect(r.points.get('B')).toBe(1);
    expect(r.note.get('A')).toBe('W2 H0 L1');
  });
  it('sixes: partners change every 6 holes', () => {
    // A is great all day: wins all three 6-hole matches with whoever partners them
    const good = Array(18).fill(3);
    const ok = Array(18).fill(4);
    const r = playGame('sixes', [row('A', good), row('B', ok), row('C', ok), row('D', ok)], holes(18))!;
    expect(r.points.get('A')).toBe(3);
    expect(r.points.get('B')).toBe(1);
    expect(r.points.get('D')).toBe(1);
    expect(playGame('sixes', [row('A', good), row('B', ok)], holes(18))).toBeNull();
  });
  it('nines: 5-3-1, ties share', () => {
    const r = playGame('nines', [row('A', [3, 4]), row('B', [4, 4]), row('C', [5, 4])], holes(2))!;
    // Hole 1: 5-3-1; hole 2 all tied: 3 each
    expect(r.points.get('A')).toBe(8);
    expect(r.points.get('B')).toBe(6);
    expect(r.points.get('C')).toBe(4);
  });
});
