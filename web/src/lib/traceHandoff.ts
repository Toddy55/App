import type { Pt } from './tracer';

/** A clip from the live tracer, handed to the tracer editor to save, share or fix. */
export interface TraceHandoff {
  file: File;
  start: Pt & { t: number };
  end: Pt & { t: number };
  apex: Pt;
}

let pending: TraceHandoff | null = null;

export function handOff(h: TraceHandoff) {
  pending = h;
}

export function takeHandoff(): TraceHandoff | null {
  const h = pending;
  pending = null;
  return h;
}
