import { describe, expect, it } from 'vitest';
import { parseHcp } from './HandicapEditor';

describe('parseHcp', () => {
  it('takes decimals with a dot or a comma', () => {
    expect(parseHcp('11.4')).toBe(11.4);
    expect(parseHcp('11,4')).toBe(11.4);
    expect(parseHcp('.5')).toBe(0.5);
    expect(parseHcp('36')).toBe(36);
  });
  it('waits while the number is half typed', () => {
    expect(parseHcp('11.')).toBeNull();
    expect(parseHcp('+')).toBeNull();
    expect(parseHcp('')).toBeNull();
  });
  it('stores plus handicaps as negatives', () => {
    expect(parseHcp('+2.1')).toBe(-2.1);
  });
  it('rejects nonsense and out-of-range numbers', () => {
    expect(parseHcp('60')).toBeNull();
    expect(parseHcp('1.2.3')).toBeNull();
  });
});
