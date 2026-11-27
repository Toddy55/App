import { fitShot, solveSpeedFactor, type Camera, type Obs, type ShotResult } from './ballflight';

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, (v: { res?: ShotResult | null; factor?: number; error?: string }) => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./fitWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const cb = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      cb?.(e.data);
    };
    return worker;
  } catch {
    return null;
  }
}

/** Fit a shot in the background (falls back to the main thread if workers aren't available). */
export function fitInBackground(cam: Camera, obs: Obs[], club: string | undefined, speedFactor: number, straight = false): Promise<ShotResult | null> {
  const w = getWorker();
  if (!w) return Promise.resolve(fitShot(cam, obs, undefined, 1, club, speedFactor, { straight }));
  const id = nextId++;
  return new Promise((resolve) => {
    waiting.set(id, (v) => resolve(v.res ?? null));
    w.postMessage({ id, kind: 'fit', cam, obs, club, speedFactor, straight });
  });
}

export function calibrateInBackground(
  cam: Camera,
  obs: Obs[],
  club: string | undefined,
  actualCarry: number,
  speedFactor: number,
): Promise<{ factor: number; res: ShotResult | null }> {
  const w = getWorker();
  if (!w) {
    const factor = solveSpeedFactor(cam, obs, club, actualCarry, speedFactor);
    return Promise.resolve({ factor, res: fitShot(cam, obs, undefined, 1, club, factor) });
  }
  const id = nextId++;
  return new Promise((resolve) => {
    waiting.set(id, (v) => resolve({ factor: v.factor ?? speedFactor, res: v.res ?? null }));
    w.postMessage({ id, kind: 'calibrate', cam, obs, club, actualCarry, speedFactor });
  });
}
