import type { Round } from '../types';
import { store } from '../lib/storage';
import { sidesFor } from '../lib/scoring';
import { liveAvailable } from './config';

/**
 * When the scorer enters something worth talking about (a birdie, or a blow-up
 * hole), post it to the comp banter. Waits a few seconds so tapping + up to a
 * 7 doesn't shout at every number on the way, and only shouts once per hole.
 */
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function queueShoutout(roundId: string, sideId: string, holeNumber: number) {
  const key = `${roundId}|${sideId}|${holeNumber}`;
  const t = timers.get(key);
  if (t) clearTimeout(t);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      const round = store.round(roundId);
      if (round) shout(round, sideId, holeNumber).catch(() => undefined);
    }, 4000),
  );
}

export function shoutoutText(round: Round, sideId: string, holeNumber: number): string | null {
  const hole = round.holes.find((h) => h.number === holeNumber);
  const g = round.scores[sideId]?.[holeNumber];
  const side = sidesFor(round).find((s) => s.id === sideId);
  if (!hole || !g || !side) return null;
  const who = side.name;
  const where = `the ${ordinal(holeNumber)}`;
  const diff = g - hole.par;
  if (g === 1) return `🎯⛳ HOLE IN ONE! ${who} on ${where}! Bar's open 🍻🍻🍻`;
  if (diff <= -3) return `🦅🦅 Albatross for ${who} on ${where}! Somebody check the card 👀`;
  if (diff === -2) return `🦅 Eagle! ${who} on ${where}. Showing off now 💪`;
  if (diff === -1) return `🐦 Birdie for ${who} on ${where}! 🔥`;
  if (diff >= 4) return `💀 ${who} just carded a ${g} on ${where}. Thoughts and prayers 🪦`;
  if (diff === 3) return `🚑 ${who} with a ${g} on ${where}. Somebody call it in 🤡`;
  return null;
}

async function shout(round: Round, sideId: string, holeNumber: number) {
  if (!round.compIds?.length || !liveAvailable() || round.completed) return;
  const text = shoutoutText(round, sideId, holeNumber);
  if (!text) return;
  const done = `gtg.shout.${round.id}.${sideId}.${holeNumber}`;
  try {
    if (localStorage.getItem(done) === text) return;
    localStorage.setItem(done, text);
  } catch {
    /* ignore */
  }
  const { sendChat } = await import('./chat');
  const name = store.settings().me.name;
  await Promise.all(round.compIds.map((c) => sendChat(c, name, text, true)));
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
