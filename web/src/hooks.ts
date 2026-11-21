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

/** One-off position fix. Rough is fine for finding nearby courses; precise for mapping a green. */
export function getPosition(precise = true): Promise<LatLon> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('GPS not available on this device'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) =>
        reject(
          new Error(
            e.code === e.PERMISSION_DENIED
              ? 'Location is turned off for this app. On iPhone: Settings → Privacy & Security → Location Services → Safari Websites → "While Using the App", then try again.'
              : e.code === e.TIMEOUT
                ? 'Couldn\'t get a GPS fix in time. Try again, or search by course or town name instead.'
                : 'Couldn\'t get your location. Try searching by course or town name instead.',
          ),
        ),
      precise ? { enableHighAccuracy: true, timeout: 20000 } : { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 },
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
