import { describe, expect, it } from 'vitest';
import { buildBag } from './caddy';

describe('buildBag with your own distances', () => {
  it('uses the number you entered for a club', () => {
    const bag = buildBag({ me: { id: 'me', name: 'T', gaHandicap: 11 }, units: 'm', clubs: ['Driver', '7i', 'PW'], myDistances: { '7i': 145 } }, [], 11);
    const seven = bag.find((c) => c.club === '7i')!;
    expect(seven.source).toBe('mine');
    expect(Math.round(seven.total)).toBe(145);
    expect(bag.find((c) => c.club === 'PW')!.source).toBe('typical');
  });
});
