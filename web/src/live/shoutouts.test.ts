import { describe, expect, it } from 'vitest';
import type { Round } from '../types';
import { shoutoutText } from './shoutouts';

const round = (score: number, par = 4): Round => ({
  id: 'r', courseId: 'c', courseName: 'C', date: '2026-11-21', format: 'stableford', meId: 'me',
  holes: [{ number: 4, par, si: 1 }],
  players: [{ id: 'me', name: 'Toddy', gaHandicap: 10, dailyHandicap: 10, playingHandicap: 10 }],
  scores: { me: { 4: score } }, stats: {}, shots: {}, pins: {},
  options: { allowance: 100, skinsNet: false, skinsCarryOver: true }, completed: false, startedAt: 1,
});

describe('shout-outs', () => {
  it('calls out birdies, eagles and aces', () => {
    expect(shoutoutText(round(3), 'me', 4)).toBe('🐦 Birdie for Toddy on the 4th! 🔥');
    expect(shoutoutText(round(2), 'me', 4)).toMatch(/^🦅 Eagle! Toddy on the 4th/);
    expect(shoutoutText(round(1, 3), 'me', 4)).toMatch(/HOLE IN ONE/);
  });
  it('stirs on blow-ups and stays quiet otherwise', () => {
    expect(shoutoutText(round(7), 'me', 4)).toMatch(/🚑 Toddy with a 7/);
    expect(shoutoutText(round(9), 'me', 4)).toMatch(/💀 Toddy just carded a 9/);
    expect(shoutoutText(round(4), 'me', 4)).toBeNull();
    expect(shoutoutText(round(6), 'me', 4)).toBeNull();
  });
});
