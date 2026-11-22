import type { LatLon } from '../types';

/**
 * Stand on a spot (the pin, your ball) and get the best GPS fix for it:
 * phone GPS jumps a few metres, so take readings for a few seconds and
 * average them, trusting the sharper ones more.
 */
export function averageFix(samples: { pos: LatLon; acc: number }[]): { pos: LatLon; acc: number } | null {
  const good = samples.filter((s) => Number.isFinite(s.acc) && s.acc > 0 && s.acc < 50);
  if (!good.length) return null;
  // Drop the worst third when we have plenty
  const use = good.length >= 6 ? [...good].sort((a, b) => a.acc - b.acc).slice(0, Math.ceil(good.length * 0.67)) : good;
  let w = 0;
  let lat = 0;
  let lon = 0;
  for (const s of use) {
    const k = 1 / (s.acc * s.acc);
    w += k;
    lat += s.pos.lat * k;
    lon += s.pos.lon * k;
  }
  // Averaging n independent fixes tightens the error by about √n
  const best = Math.min(...use.map((s) => s.acc));
  const acc = Math.max(1, Math.min(best, Math.sqrt(1 / w) * 1.2));
  return { pos: { lat: lat / w, lon: lon / w }, acc };
}

export function sampleFix(ms = 4000, latest?: { pos: LatLon; acc: number }): Promise<{ pos: LatLon; acc: number }> {
  return new Promise((ok, bad) => {
    if (!('geolocation' in navigator)) return bad(new Error('GPS not available on this phone'));
    const samples: { pos: LatLon; acc: number }[] = [];
    const add = (p: GeolocationPosition) => samples.push({ pos: { lat: p.coords.latitude, lon: p.coords.longitude }, acc: p.coords.accuracy || 5 });
    const opts = { enableHighAccuracy: true, maximumAge: 0, timeout: ms + 4000 };
    const id = navigator.geolocation.watchPosition(add, () => undefined, opts);
    navigator.geolocation.getCurrentPosition(add, () => undefined, opts);
    setTimeout(() => {
      navigator.geolocation.clearWatch(id);
      // No fresh readings in time: fall back to the app's latest fix
      if (!samples.length && latest) samples.push(latest);
      const fix = averageFix(samples);
      if (fix) ok(fix);
      else bad(new Error('No GPS fix yet. Give it a few seconds and try again.'));
    }, ms);
  });
}

/** Read the putt out loud (in an Aussie voice if the phone has one). */
export function speak(text: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const words = text
      .replace(/(\d+(?:\.\d)?) m putt/g, '$1 metre putt')
      .replace(/(\d+) cm/g, '$1 centimetres')
      .replace(/(\d)½/g, '$1 and a half')
      .replace(/½/g, 'half a')
      .replace(/;/g, '.');
    const u = new SpeechSynthesisUtterance(words);
    const voices = synth.getVoices();
    u.voice = voices.find((v) => v.lang === 'en-AU') ?? voices.find((v) => v.lang.startsWith('en')) ?? null;
    u.lang = u.voice?.lang ?? 'en-AU';
    u.rate = 1;
    synth.cancel();
    synth.speak(u);
  } catch {
    /* no speech on this phone */
  }
}
