import { useEffect, useRef, useState } from 'react';
import type { LatLon } from './types';

export interface GeoState {
  pos?: LatLon;
  accuracy?: number;
  error?: string;
  heading?: number | null;
}

/** Continuous high-accuracy GPS while mounted. */
export function useGeolocation(enabled = true): GeoState {
  const [state, setState] = useState<GeoState>({});
  useEffect(() => {
    if (!enabled) return;
    if (!('geolocation' in navigator)) {
      setState({ error: 'GPS not available on this device' });
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) =>
        setState({
          pos: { lat: p.coords.latitude, lon: p.coords.longitude },
          accuracy: p.coords.accuracy,
          heading: p.coords.heading,
        }),
      (e) =>
        setState((s) => ({
          ...s,
          error:
            e.code === e.PERMISSION_DENIED
              ? 'Location permission denied. Allow location for this site to get distances.'
              : 'Waiting for GPS…',
        })),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);
  return state;
}

/** One-off position fix. */
export function getPosition(): Promise<LatLon> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('GPS not available'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => reject(new Error(e.message || 'Could not get your location')),
      { enableHighAccuracy: true, timeout: 20000 },
    );
  });
}

/** Keep the screen awake during a round (where supported). */
export function useWakeLock(active: boolean) {
  const lock = useRef<{ release: () => Promise<void> } | null>(null);
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    if (!active || !nav.wakeLock) return;
    let cancelled = false;
    const acquire = () =>
      nav.wakeLock!
        .request('screen')
        .then((l) => {
          if (cancelled) l.release();
          else lock.current = l;
        })
        .catch(() => {});
    acquire();
    const onVis = () => document.visibilityState === 'visible' && acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      lock.current?.release().catch(() => {});
    };
  }, [active]);
}
