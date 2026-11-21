import type { Pt } from './tracer';

/** A clip from the live tracer, handed to the tracer editor to save, share or fix. */
export interface TraceHandoff {
  file: File;
  start: Pt & { t: number };
  end: Pt & { t: number };
  apex: Pt;
  /** Full fitted flight in video pixels and clip seconds (live tracer). */
  path?: { t: number; x: number; y: number }[];
  /** Lines of shot data burned into the clip, e.g. "Carry 152 m". */
  info?: string[];
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
