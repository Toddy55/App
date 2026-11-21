import type { Round } from '../types';
import { sidesFor } from './scoring';
import { personKey } from './share';

/**
 * Cross-marking: when more than one phone is scoring the same card, nobody
 * scores themselves. Each side (player or team) is marked by a phone whose
 * owner isn't on that side; the rest are shared out evenly. Every phone works
 * this out from the same information, so they all agree.
 */
export interface MarkerPhone {
  /** The phone's live group id. */
  group: string;
  /** personKey of the phone owner's name. */
  owner: string;
  name: string;
}

export interface SideKeys {
  id: string;
  name: string;
  /** personKeys of the players on this side. */
  members: string[];
}

/** Sides of a round with their players as name keys (works for local and shared rounds). */
export function sideKeys(round: Round): SideKeys[] {
  const nameOf = (id: string) => round.players.find((p) => p.id === id)?.name ?? id;
  return sidesFor(round).map((s) => ({ id: s.id, name: s.name, members: s.memberIds.map((m) => personKey(nameOf(m))) }));
}

/** Which phone marks each side, or null when there's only one phone (it scores everyone). */
export function assignMarkers(sides: SideKeys[], phones: MarkerPhone[]): Record<string, string> | null {
  if (phones.length < 2) return null;
  const owners = new Set(phones.map((p) => p.owner));
  const count = new Map(phones.map((p) => [p.group, 0]));
  const order = (s: SideKeys) => (s.members.some((m) => owners.has(m)) ? 0 : 1);
  const out: Record<string, string> = {};
  // Sides with a phone owner on them go first: they have fewer phones that may mark them
  // ...then by who's on them (not list order or ids, which differ from phone to phone)
  const key = (s: SideKeys) => [...s.members].sort().join('|');
  for (const s of [...sides].sort((a, b) => order(a) - order(b) || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))) {
    let cands = phones.filter((p) => !s.members.includes(p.owner));
    if (!cands.length) cands = phones;
    cands = [...cands].sort((a, b) => count.get(a.group)! - count.get(b.group)! || phones.indexOf(a) - phones.indexOf(b));
    out[s.id] = cands[0].group;
    count.set(cands[0].group, count.get(cands[0].group)! + 1);
  }
  return out;
}
