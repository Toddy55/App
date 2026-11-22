import { describe, expect, it } from 'vitest';
import { clubFromSpeech } from './clubSpeech';
import { DEFAULT_CLUBS } from './storage';

describe('clubFromSpeech', () => {
  const cases: [string, string][] = [
    ['seven iron', '7i'],
    ['7 iron', '7i'],
    ['Seven', '7i'],
    ['I got a seven iron', '7i'],
    ['three wood', '3W'],
    ['5 wood', '5W'],
    ['driver', 'Driver'],
    ['the big dog', 'Driver'],
    ['pitching wedge', 'PW'],
    ['sand wedge', 'SW'],
    ['56 degree', 'SW'],
    ['52', 'GW'],
    ['lob wedge', 'LW'],
    ['4 hybrid', 'Hybrid'],
    ['putter', 'Putter'],
  ];
  for (const [said, club] of cases) it(`"${said}" → ${club}`, () => expect(clubFromSpeech(said, DEFAULT_CLUBS)).toBe(club));
  it('keeps what you said if it is not in the bag', () => expect(clubFromSpeech('chipper', DEFAULT_CLUBS)).toBe('chipper'));
  it('nothing said, no club', () => expect(clubFromSpeech('  ', DEFAULT_CLUBS)).toBeUndefined());
});
