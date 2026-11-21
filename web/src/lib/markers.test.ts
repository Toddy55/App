import { describe, expect, it } from 'vitest';
import { assignMarkers, type SideKeys } from './markers';

const side = (id: string, ...members: string[]): SideKeys => ({ id, name: id, members: members.map((m) => `p:${m}`) });
const phone = (group: string, name: string) => ({ group, owner: `p:${name}`, name });

describe('cross-marking', () => {
  it('one phone scores everyone', () => {
    expect(assignMarkers([side('a', 'toddy'), side('b', 'dazza')], [phone('g1', 'toddy')])).toBeNull();
  });

  it('two Ambrose teams: each phone marks the other team', () => {
    const sides = [side('t1', 'toddy', 'dazza'), side('t2', 'shazza', 'kev')];
    const m = assignMarkers(sides, [phone('g1', 'toddy'), phone('g2', 'shazza')])!;
    expect(m).toEqual({ t1: 'g2', t2: 'g1' });
  });

  it('a four-ball with two phones: nobody marks themselves, and it is shared out evenly', () => {
    const sides = [side('toddy', 'toddy'), side('dazza', 'dazza'), side('shazza', 'shazza'), side('kev', 'kev')];
    const m = assignMarkers(sides, [phone('g1', 'toddy'), phone('g2', 'shazza')])!;
    expect(m.toddy).toBe('g2');
    expect(m.shazza).toBe('g1');
    const counts = Object.values(m).reduce<Record<string, number>>((a, g) => ({ ...a, [g]: (a[g] ?? 0) + 1 }), {});
    expect(counts).toEqual({ g1: 2, g2: 2 });
  });

  it('every phone gets the same answer whatever order the sides come in', () => {
    const sides = [side('dazza', 'dazza'), side('kev', 'kev'), side('toddy', 'toddy'), side('shazza', 'shazza')];
    const phones = [phone('g1', 'toddy'), phone('g2', 'shazza')];
    expect(assignMarkers(sides, phones)).toEqual(assignMarkers([...sides].reverse(), phones));
  });
});
