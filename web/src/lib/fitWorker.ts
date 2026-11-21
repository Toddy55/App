/// <reference lib="webworker" />
import { fitShot, solveSpeedFactor, type Camera, type Obs } from './ballflight';

/** Runs the ball-flight fit off the main thread so the live tracer stays smooth. */
export type FitRequest =
  | { id: number; kind: 'fit'; cam: Camera; obs: Obs[]; club?: string; speedFactor: number }
  | { id: number; kind: 'calibrate'; cam: Camera; obs: Obs[]; club?: string; actualCarry: number; speedFactor: number };

self.onmessage = (e: MessageEvent<FitRequest>) => {
  const m = e.data;
  try {
    if (m.kind === 'fit') {
      const res = fitShot(m.cam, m.obs, undefined, 1, m.club, m.speedFactor);
      (self as unknown as Worker).postMessage({ id: m.id, res });
    } else {
      const factor = solveSpeedFactor(m.cam, m.obs, m.club, m.actualCarry, m.speedFactor);
      const res = fitShot(m.cam, m.obs, undefined, 1, m.club, factor);
      (self as unknown as Worker).postMessage({ id: m.id, factor, res });
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: m.id, error: String(err) });
  }
};
