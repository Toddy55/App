import { describe, expect, it } from 'vitest';
import { inviteHash } from './install';

describe('pasting an invite', () => {
  it('finds the link in a pasted message', () => {
    const msg = `Toddy wants you on Shotmate ⛳ Tap the link to link up:\nhttps://toddy55.github.io/App/#friend=zAbc_12-x\n\n📲 To make it an app…`;
    expect(inviteHash(msg)).toBe('#friend=zAbc_12-x');
    expect(inviteHash('https://toddy55.github.io/App/#join=zQ9')).toBe('#join=zQ9');
    expect(inviteHash('https://toddy55.github.io/App/#live=ABCD2345')).toBe('#live=ABCD2345');
    expect(inviteHash('see you at the 19th')).toBeNull();
    expect(inviteHash('https://toddy55.github.io/App/#friend=zAb&to=Jarrod%20B')).toBe('#friend=zAb&to=Jarrod%20B');
  });
});
