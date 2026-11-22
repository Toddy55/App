import { describe, expect, it } from 'vitest';
import { averageFix } from './spotMark';

describe('averageFix', () => {
  it('trusts sharper readings more and tightens the error', () => {
    const f = averageFix([
      { pos: { lat: -26, lon: 153 }, acc: 4 },
      { pos: { lat: -26.00001, lon: 153 }, acc: 4 },
      { pos: { lat: -26.001, lon: 153 }, acc: 40 },
    ])!;
    expect(Math.abs(f.pos.lat + 26.000005)).toBeLessThan(0.00002);
    expect(f.acc).toBeLessThanOrEqual(4);
  });
  it('ignores junk', () => expect(averageFix([{ pos: { lat: 0, lon: 0 }, acc: 500 }])).toBeNull());
});
