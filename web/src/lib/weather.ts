import type { LatLon, WeatherSnapshot } from '../types';

/** Live conditions from Open-Meteo (free, no key, uses BoM and other national models). */
export async function fetchWeather(at: LatLon): Promise<WeatherSnapshot> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${at.lat.toFixed(4)}&longitude=${at.lon.toFixed(4)}` +
    `&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kmh&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather service returned ${res.status}`);
  const j = await res.json();
  const c = j.current;
  return {
    t: Date.now(),
    windKmh: c.wind_speed_10m,
    gustKmh: c.wind_gusts_10m,
    windFromDeg: c.wind_direction_10m,
    tempC: c.temperature_2m,
  };
}

/** Ground elevation in metres for a set of points. */
export async function fetchElevations(points: LatLon[]): Promise<number[]> {
  const lat = points.map((p) => p.lat.toFixed(5)).join(',');
  const lon = points.map((p) => p.lon.toFixed(5)).join(',');
  const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`);
  if (!res.ok) throw new Error(`Elevation service returned ${res.status}`);
  const j = await res.json();
  return j.elevation as number[];
}

export const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

export interface WindEffect {
  /** + headwind, − tailwind, km/h */
  head: number;
  /** + wind pushing ball right, − pushing left, km/h */
  cross: number;
  label: string;
  /** Wind direction relative to the shot line: 0 = straight into you. Used to rotate the arrow. */
  relativeDeg: number;
}

export function windEffect(windFromDeg: number, windKmh: number, shotBearingDeg: number): WindEffect {
  const rel = (((windFromDeg - shotBearingDeg) % 360) + 360) % 360;
  const r = (rel * Math.PI) / 180;
  const head = windKmh * Math.cos(r);
  // Wind from the right of the target line (rel 0..180) blows the ball left.
  const cross = -windKmh * Math.sin(r);
  const parts: string[] = [];
  if (windKmh < 4) return { head, cross, label: 'Calm', relativeDeg: rel };
  if (Math.abs(head) >= 3) parts.push(`${Math.round(Math.abs(head))} ${head > 0 ? 'into' : 'helping'}`);
  if (Math.abs(cross) >= 3) parts.push(`${Math.round(Math.abs(cross))} ${cross > 0 ? 'L→R' : 'R→L'}`);
  return { head, cross, label: parts.join(', ') || 'Light', relativeDeg: rel };
}

export interface PlaysLike {
  distance: number;
  windAdj: number;
  elevAdj: number;
  tempAdj: number;
  /** Metres to aim off, + = aim right, − = aim left. */
  aimOffM: number;
}

/**
 * "Plays like" distance. Rules of thumb used by caddies:
 *  - headwind ~ +1% per mph (≈0.6% per km/h), tailwind ~ −0.5% per mph (≈0.3% per km/h)
 *  - elevation: ~1 m per metre of rise or fall
 *  - temperature: ~1% per 5 °C away from 20 °C (colder = shorter)
 *  - crosswind drift ~ 0.25% of distance per km/h at full carry
 */
export function playsLike(distanceM: number, effect: WindEffect | undefined, elevDiffM = 0, tempC?: number): PlaysLike {
  let windAdj = 0;
  let aimOffM = 0;
  if (effect) {
    windAdj = effect.head > 0 ? distanceM * 0.006 * effect.head : distanceM * 0.003 * effect.head;
    // aim into the wind: if the wind pushes right, aim left
    aimOffM = -(effect.cross * distanceM * 0.0025);
  }
  const elevAdj = elevDiffM;
  const tempAdj = tempC != null ? distanceM * ((20 - tempC) / 5) * 0.01 : 0;
  return {
    distance: distanceM + windAdj + elevAdj + tempAdj,
    windAdj,
    elevAdj,
    tempAdj,
    aimOffM,
  };
}
