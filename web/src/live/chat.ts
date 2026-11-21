import { liveAvailable } from './config';

/**
 * Comp banter. Each message is its own entry under the comp's chat channel
 * (on the same Firebase space as live scoring, so no extra setup). Keys start
 * with the time, so they sort in order and we can fetch just the latest.
 */
export interface ChatMsg {
  id: string;
  name: string;
  text: string;
  at: number;
  mine: boolean;
  /** Posted by the app (e.g. "Toddy birdied the 4th"). */
  auto?: boolean;
}

export const chatChannel = (compId: string) => `chat-${compId}`;

function msgId(): string {
  const rand = crypto.getRandomValues(new Uint8Array(3));
  return 'm' + Date.now().toString(36) + Array.from(rand, (b) => (b % 36).toString(36)).join('');
}

export async function sendChat(compId: string, name: string, text: string, auto = false): Promise<void> {
  if (!liveAvailable()) throw new Error("Chat needs live sync, which isn't set up in this copy of the app.");
  const clean = text.trim().slice(0, 500);
  if (!clean) return;
  const { pushGroup } = await import('./live');
  await pushGroup(chatChannel(compId), msgId(), {
    data: JSON.stringify({ name, text: clean, at: Date.now(), auto }),
    status: 'live',
    hole: 0,
    headline: 'chat',
    scorer: name,
  });
}

export async function watchChat(compId: string, onMsgs: (m: ChatMsg[]) => void, limit = 150): Promise<() => void> {
  if (!liveAvailable()) return () => undefined;
  const { watchLatest, myUid } = await import('./live');
  const uid = await myUid();
  return watchLatest(
    chatChannel(compId),
    limit,
    (docs) => {
      const out: ChatMsg[] = [];
      for (const [id, d] of Object.entries(docs ?? {})) {
        try {
          const m = JSON.parse(d.data) as { name?: string; text?: string; at?: number; auto?: boolean };
          if (typeof m.text !== 'string' || !m.text.trim()) continue;
          out.push({ id, name: String(m.name ?? 'Someone').slice(0, 40), text: m.text.slice(0, 500), at: Number(m.at) || d.updatedAt, mine: d.owner === uid, auto: !!m.auto });
        } catch {
          /* skip */
        }
      }
      onMsgs(out.sort((a, b) => (a.id < b.id ? -1 : 1)));
    },
    () => undefined,
  );
}

const seenKey = (compId: string) => `gtg.chatSeen.${compId}`;
export function lastSeen(compId: string): string {
  try {
    return localStorage.getItem(seenKey(compId)) ?? '';
  } catch {
    return '';
  }
}
export function markSeen(compId: string, id: string) {
  try {
    localStorage.setItem(seenKey(compId), id);
  } catch {
    /* ignore */
  }
}

/** Golf and stirring emojis for the picker. */
export const EMOJIS = [
  '⛳', '🏌️‍♂️', '🏌️', '🏆', '🥇', '🥈', '🥉', '🐦', '🦅', '🦆', '🐔', '🐐', '🐌', '🌊', '🏖️', '🌳',
  '🪓', '🚑', '💀', '🪦', '🤡', '💩', '🔥', '🧊', '🥶', '😂', '🤣', '😭', '😤', '🙄', '🤦‍♂️', '🫣',
  '👀', '🍺', '🍻', '🌭', '💸', '🤑', '🚨', '🎯', '💪', '🙌', '👏', '🫡', '🤌', '🐯', '🦘', '🧢',
];

/** One-tap sledges. */
export const SLEDGES = [
  'Nice lay up, chook 🐔',
  'Grip it and rip it 🔥',
  'Wet one! 🌊',
  'Building sandcastles again? 🏖️',
  'Taking the scenic route 🌳',
  'Sandbagger alert 🚨',
  'Is that your score or your handicap? 🤣',
  'Three-putt Pete strikes again 😭',
  'Was that a practice swing? 🤡',
  'Duck on the card 🦆',
  'Shank you very much 🪓',
  'Ball is in the next postcode 🚑',
  "Hurry up, I've got a tee time tomorrow 🐌",
  'Who is the GOAT now? 🐐',
  'Shout the bar 🍻',
  'Pay up, legend 💸',
  'Get in the hole! ⛳',
];
