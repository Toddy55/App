import type { Hazard, Hole, LatLon, Round, Settings } from '../types';
import { bearingDeg, distanceM, fromLocal, pointInPolygon, toLocal } from './geo';
import { clubDistances } from './analysis';
import { playsLike, windEffect } from './weather';
import { stablefordPoints, strokesByHole } from './handicap';

/**
 * The caddy: picks the club and aim point that save the most shots.
 *
 * For each sensible club and aim line it "plays" the shot a few hundred times
 * with this golfer's distance, spread and usual miss, plus the wind, then
 * scores every landing spot with the expected strokes to hole out from there
 * (green, fairway, rough, bunker or water). The best average, nudged for how
 * the round is going, wins.
 */

// ---------- the golfer's bag ----------

export interface ClubModel {
  club: string;
  /** Typical total distance in still air on flat ground (m). */
  total: number;
  /** Roll after landing (m). */
  roll: number;
  sdLong: number;
  sdLat: number;
  source: 'tracked' | 'typical' | 'mine';
}

/** Typical totals (m) for a 15-handicap club golfer. */
const TYPICAL: [RegExp, number, number][] = [
  // pattern, total, roll
  [/^dr|driver/i, 205, 18],
  [/3\s*w|3\s*wood/i, 185, 14],
  [/5\s*w|7\s*w|wood/i, 172, 11],
  [/hy|rescue|utility/i, 162, 8],
  [/^3\s*i/i, 158, 6],
  [/^4\s*i/i, 152, 6],
  [/^5\s*i/i, 144, 5],
  [/^6\s*i/i, 136, 5],
  [/^7\s*i/i, 128, 4],
  [/^8\s*i/i, 118, 4],
  [/^9\s*i/i, 108, 3],
  [/^pw|pitching/i, 97, 3],
  [/^gw|^aw|gap|approach/i, 86, 2],
  [/^sw|sand/i, 74, 2],
  [/^lw|lob/i, 60, 1],
];

export function buildBag(settings: Settings, rounds: Round[], handicap: number, speedFactor = 1): ClubModel[] {
  const tracked = new Map(clubDistances(rounds).map((c) => [c.club, c]));
  const skill = 1 + (15 - Math.max(-5, Math.min(40, handicap))) * 0.008;
  const bag: ClubModel[] = [];
  for (const club of settings.clubs) {
    if (/putt/i.test(club)) continue;
    const t = TYPICAL.find(([re]) => re.test(club.trim()));
    if (!t) continue;
    let total = t[1] * skill * Math.pow(speedFactor, 1.2);
    let source: ClubModel['source'] = 'typical';
    const tr = tracked.get(club);
    const mine = settings.myDistances?.[club];
    if (mine && mine > 20) {
      // Your own number comes first; lots of tracked shots nudge it
      total = (mine * 8 + (tr && tr.n >= 3 ? tr.avg * tr.n : 0)) / (8 + (tr && tr.n >= 3 ? tr.n : 0));
      source = 'mine';
    } else if (tr && tr.n >= 3) {
      // trust the golfer's own numbers more the more shots we have
      total = (tr.avg * tr.n + total * 3) / (tr.n + 3);
      source = 'tracked';
    }
    const isDriver = /^dr|driver/i.test(club);
    const hcp = Math.max(0, handicap);
    bag.push({
      club,
      total,
      roll: t[2],
      sdLat: total * (0.045 + hcp * 0.0025) * (isDriver ? 1.25 : 1),
      sdLong: total * (0.035 + hcp * 0.0018),
      source,
    });
  }
  return bag.sort((a, b) => b.total - a.total);
}

// ---------- the golfer's usual miss ----------

export interface Tendencies {
  /** Typical miss as a fraction of the sideways spread (+ = right). */
  lat: number;
  /** Typical miss as a fraction of the distance spread (+ = long). */
  long: number;
  notes: string[];
}

export function tendencies(rounds: Round[], current?: Round): Tendencies {
  let L = 0,
    R = 0,
    S = 0,
    Lg = 0;
  const recent = rounds.filter((r) => r.completed).sort((a, b) => b.startedAt - a.startedAt).slice(0, 5);
  const add = (r: Round, w: number) => {
    for (const s of Object.values(r.stats ?? {})) {
      if (s.fairway === 'left') L += w;
      if (s.fairway === 'right') R += w;
      if (s.approachMiss === 'short') S += w;
      if (s.approachMiss === 'long') Lg += w;
    }
  };
  recent.forEach((r) => add(r, 1));
  if (current) add(current, 2); // today counts double
  const lat = ((R - L) / (R + L + 4)) * 0.6;
  const long = ((Lg - S) / (Lg + S + 4)) * 0.6;
  const notes: string[] = [];
  if (lat > 0.12) notes.push("You've been missing right, so I've allowed for it.");
  if (lat < -0.12) notes.push("You've been missing left, so I've allowed for it.");
  if (long < -0.12) notes.push("Your approaches have been coming up short, so this is club enough to get there.");
  if (long > 0.12) notes.push("You've been flying it long, so this is tempered a touch.");
  return { lat, long, notes };
}

// ---------- expected strokes from anywhere ----------

export type Lie = 'green' | 'fairway' | 'rough' | 'bunker' | 'water';

function interp(table: [number, number][], x: number): number {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1];
      const [x1, y1] = table[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  const [xa, ya] = table[table.length - 2];
  const [xb, yb] = table[table.length - 1];
  return yb + ((yb - ya) * (x - xb)) / (xb - xa);
}

// Tour averages (strokes to hole out), metres
const PUTT: [number, number][] = [[0.3, 1.0], [0.9, 1.04], [1.5, 1.23], [2.4, 1.5], [3, 1.61], [4.6, 1.78], [6.1, 1.87], [9.1, 1.98], [12.2, 2.06], [18.3, 2.2], [27, 2.4]];
const FAIRWAY: [number, number][] = [[5, 2.18], [18, 2.4], [37, 2.6], [55, 2.7], [91, 2.8], [137, 2.98], [183, 3.19], [229, 3.45], [274, 3.71], [366, 3.99], [457, 4.4], [550, 4.8]];
const ROUGH: [number, number][] = [[5, 2.3], [18, 2.59], [37, 2.78], [55, 2.87], [91, 3.02], [137, 3.21], [183, 3.42], [229, 3.65], [274, 3.9], [366, 4.2], [457, 4.6]];
const SAND: [number, number][] = [[5, 2.4], [18, 2.53], [37, 2.82], [91, 3.23], [137, 3.4], [183, 3.55], [229, 3.8]];

/** Expected strokes to hole out from a lie and distance, for a golfer of this handicap. */
export function expectedStrokes(lie: Lie, dist: number, handicap: number): number {
  const h = Math.max(0, handicap);
  switch (lie) {
    case 'green':
      return interp(PUTT, dist) + h * 0.006 * Math.min(2, dist / 5 + 0.5);
    case 'fairway':
      return interp(FAIRWAY, dist) + h * (0.02 + dist * 0.00006);
    case 'rough':
      return interp(ROUGH, dist) + h * (0.025 + dist * 0.00007);
    case 'bunker':
      return interp(SAND, dist) + h * (0.035 + dist * 0.00007);
    case 'water':
      // penalty stroke, then play on from the rough near where it went in
      return 1 + interp(ROUGH, dist) + h * (0.025 + dist * 0.00007);
  }
}

// ---------- the hole as the caddy sees it ----------

export interface HoleGeo {
  hole: Hole;
  pin: LatLon;
  hazards: Hazard[];
  hasFairways: boolean;
}

export function holeGeo(hole: Hole, hazards: Hazard[] | undefined, pin?: LatLon): HoleGeo | null {
  if (!hole.green) return null;
  const target = pin ?? hole.green.centre;
  // only hazards around this hole
  const anchor = [hole.tee, hole.green.centre, ...(hole.path ?? [])].filter(Boolean) as LatLon[];
  const span = Math.max(150, hole.lengthM ?? (hole.tee ? distanceM(hole.tee, hole.green.centre) : 300));
  const near = (hazards ?? []).filter((z) => z.poly.some((p) => anchor.some((a) => distanceM(a, p) < span * 0.75 + 60)));
  return { hole, pin: target, hazards: near, hasFairways: near.some((z) => z.kind === 'fairway') };
}

function distToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function lieAt(geo: HoleGeo, p: LatLon): Lie {
  const g = geo.hole.green!;
  if (g.polygon ? pointInPolygon(p, g.polygon) : distanceM(p, g.centre) < 13) return 'green';
  for (const z of geo.hazards) if (z.kind === 'water' && pointInPolygon(p, z.poly)) return 'water';
  for (const z of geo.hazards) if (z.kind === 'bunker' && pointInPolygon(p, z.poly)) return 'bunker';
  if (geo.hasFairways) return geo.hazards.some((z) => z.kind === 'fairway' && pointInPolygon(p, z.poly)) ? 'fairway' : 'rough';
  // No fairway outlines: assume a 30 m wide fairway along the line of play
  const line = geo.hole.path ?? (geo.hole.tee ? [geo.hole.tee, g.centre] : null);
  if (!line) return 'rough';
  const o = line[0];
  const q = toLocal(o, p);
  for (let i = 1; i < line.length; i++) {
    if (distToSegment(q, toLocal(o, line[i - 1]), toLocal(o, line[i])) < 15) return distanceM(p, g.centre) > 40 ? 'fairway' : 'rough';
  }
  return 'rough';
}

// ---------- playing the shot many times ----------

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r: () => number) {
  const u = Math.max(1e-9, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

export interface Conditions {
  windKmh?: number;
  windFromDeg?: number;
  tempC?: number;
  /** Target higher (+) or lower (−) than the golfer, metres. */
  elevDiff?: number;
}

export interface Option {
  club: ClubModel;
  /** Where to aim (a point at the club's plays-like distance). */
  aim: LatLon;
  /** Expected strokes to finish the hole, including this one. */
  ev: number;
  sd: number;
  score: number;
  trouble: Partial<Record<Lie, number>>;
  /** Average landing spot and spread, for drawing on the map. */
  landing: { centre: LatLon; bearing: number; sdLong: number; sdLat: number };
  carryReal: number;
}

const SAMPLES = 140;

function evaluate(
  geo: HoleGeo,
  from: LatLon,
  club: ClubModel,
  lateralAim: number,
  cond: Conditions,
  tend: Tendencies,
  handicap: number,
  seed: number,
): Option {
  const toPin = distanceM(from, geo.pin);
  const brg = bearingDeg(from, geo.pin);
  // The club flies its total in still air; wind, slope and temperature change how far that really goes
  const eff = cond.windKmh != null && cond.windFromDeg != null ? windEffect(cond.windFromDeg, cond.windKmh, brg) : undefined;
  const pl = playsLike(club.total, eff, cond.elevDiff ?? 0, cond.tempC);
  const k = pl.distance / club.total; // >1 means it plays longer than it is
  const realTotal = club.total / k;
  const drift = -pl.aimOffM; // sideways push from the wind at that distance
  // direction: pin line, swung sideways so the ball is aimed `lateralAim` metres off at the landing distance
  const swing = Math.atan2(lateralAim, Math.max(20, realTotal)) * (180 / Math.PI);
  const dir = ((brg + swing) * Math.PI) / 180;
  const ux = Math.sin(dir),
    uy = Math.cos(dir);
  const r = rng(seed);
  let sum = 0,
    sum2 = 0;
  const trouble: Partial<Record<Lie, number>> = {};
  let cx = 0,
    cy = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const along = realTotal + gauss(r) * club.sdLong + tend.long * club.sdLong;
    const side = drift * (along / Math.max(1, realTotal)) + gauss(r) * club.sdLat + tend.lat * club.sdLat;
    const x = ux * along + uy * side;
    const y = uy * along - ux * side;
    const land = fromLocal(from, x, y);
    const lie = lieAt(geo, land);
    const d = distanceM(land, geo.pin);
    const e = 1 + expectedStrokes(lie, d, handicap);
    sum += e;
    sum2 += e * e;
    if (lie === 'water' || lie === 'bunker') trouble[lie] = (trouble[lie] ?? 0) + 1;
    cx += x;
    cy += y;
  }
  const ev = sum / SAMPLES;
  const sd = Math.sqrt(Math.max(0, sum2 / SAMPLES - ev * ev));
  for (const kk of Object.keys(trouble) as Lie[]) trouble[kk] = trouble[kk]! / SAMPLES;
  const aim = fromLocal(from, ux * realTotal, uy * realTotal);
  void toPin;
  return {
    club,
    aim,
    ev,
    sd,
    score: ev,
    trouble,
    landing: { centre: fromLocal(from, cx / SAMPLES, cy / SAMPLES), bearing: (dir * 180) / Math.PI, sdLong: club.sdLong, sdLat: club.sdLat },
    carryReal: realTotal,
  };
}

// ---------- how the round is going ----------

export interface Mood {
  /** Extra weight on avoiding big numbers (0 = pure average, higher = safer). */
  caution: number;
  note?: string;
}

export function roundMood(round: Round | undefined, holeNumber: number): Mood {
  if (!round) return { caution: 0.12 };
  const me = round.scores[round.meId] ?? {};
  const played = round.holes.filter((h) => h.number !== holeNumber && me[h.number] != null);
  const last = [...played].reverse()[0];
  if (last && me[last.number] - last.par >= 2) return { caution: 0.35, note: 'After the last hole, take the safe play and steady the ship.' };
  if (round.format === 'stableford' || round.format === 'fourball') {
    const p = round.players.find((x) => x.id === round.meId);
    const strokes = p ? strokesByHole(p.playingHandicap, round.holes) : {};
    const pts = played.reduce((s, h) => s + stablefordPoints(me[h.number], h.par, strokes[h.number] ?? 0), 0);
    const pace = pts - played.length * 2;
    const left = round.holes.length - played.length;
    if (pace >= 3) return { caution: 0.25, note: `You're ${pace} points ahead of pace. Protect the card and keep it in play.` };
    if (pace <= -6 && left <= 8) return { caution: 0.0, note: `You're chasing (${-pace} points behind pace), so this is the attacking play.` };
  }
  return { caution: 0.12 };
}

// ---------- the recommendation ----------

export interface Advice {
  mode: 'tee' | 'approach';
  from: LatLon;
  toPin: number;
  best: Option;
  alt?: Option;
  headline: string;
  aimText: string;
  lines: string[];
  trouble: { kind: 'water' | 'bunker'; pct: number }[];
  playsLike: number;
}

export function advise(opts: {
  hole: Hole;
  hazards?: Hazard[];
  pin?: LatLon;
  from: LatLon;
  bag: ClubModel[];
  cond: Conditions;
  tend: Tendencies;
  handicap: number;
  mood: Mood;
  units: 'm' | 'yd';
}): Advice | null {
  const geo = holeGeo(opts.hole, opts.hazards, opts.pin);
  if (!geo || opts.bag.length === 0) return null;
  const { from, bag, cond, tend, handicap, mood } = opts;
  const toPin = distanceM(from, geo.pin);
  if (toPin < 25) return null; // short game: no club advice needed
  const brg = bearingDeg(from, geo.pin);
  const eff = cond.windKmh != null && cond.windFromDeg != null ? windEffect(cond.windFromDeg, cond.windKmh, brg) : undefined;
  const plPin = playsLike(toPin, eff, cond.elevDiff ?? 0, cond.tempC);
  const reachable = bag[0].total * 1.05 >= plPin.distance - 15;
  const mode: Advice['mode'] = reachable ? 'approach' : 'tee';

  // which clubs are worth trying: around the distance when going for it, anything shorter for lay-ups
  const clubs = bag.filter((c) => (mode === 'approach' ? c.total > plPin.distance - 70 && c.total < plPin.distance + 45 : c.total < plPin.distance + 30));
  const laterals = mode === 'approach' ? [-18, -12, -8, -5, -2, 0, 2, 5, 8, 12, 18] : [-30, -20, -12, -6, 0, 6, 12, 20, 30];
  let best: Option | null = null;
  const perClub = new Map<string, Option>();
  let seed = 7;
  for (const c of clubs.length ? clubs : bag.slice(0, 3)) {
    for (const lat of laterals) {
      const o = evaluate(geo, from, c, lat, cond, tend, handicap, seed++);
      o.score = o.ev + mood.caution * o.sd;
      if (!best || o.score < best.score) best = o;
      const pc = perClub.get(c.club);
      if (!pc || o.score < pc.score) perClub.set(c.club, o);
    }
  }
  if (!best) return null;
  // the best alternative with a different club, to explain the choice
  const alt = [...perClub.values()].filter((o) => o.club.club !== best!.club.club).sort((a, b) => a.score - b.score)[0];

  const fmt = (m: number) => `${Math.round(opts.units === 'yd' ? m * 1.0936 : m)}${opts.units === 'yd' ? ' yd' : ' m'}`;
  // describe the aim point relative to the pin (approach) or the line of play (tee)
  const aimRel = toLocal(from, best.aim);
  const pinRel = toLocal(from, geo.pin);
  const ux = Math.sin((brg * Math.PI) / 180),
    uy = Math.cos((brg * Math.PI) / 180);
  const side = (aimRel.x - pinRel.x) * uy - (aimRel.y - pinRel.y) * ux; // + = right of pin line
  let aimText: string;
  if (mode === 'approach') {
    const sideTxt = Math.abs(side) < 2 ? 'straight at the pin' : `${fmt(Math.abs(side))} ${side > 0 ? 'right' : 'left'} of the pin`;
    const depth = best.carryReal + best.club.roll * 0.3 - toPin;
    const depthTxt = Math.abs(depth) < 4 ? ', pin-high' : depth < 0 ? `, landing ${fmt(-depth)} short to release onto it` : ` and ${fmt(depth)} past it`;
    aimText = `Aim ${sideTxt}${depthTxt}`;
  } else {
    const sideTxt = Math.abs(side) < 3 ? 'down the middle' : `${fmt(Math.abs(side))} ${side > 0 ? 'right' : 'left'} of the line to the flag`;
    aimText = `Aim ${sideTxt}, leaving about ${fmt(distanceM(best.landing.centre, geo.pin))} in`;
  }

  const trouble = (['water', 'bunker'] as const)
    .map((k) => ({ kind: k, pct: Math.round((best!.trouble[k] ?? 0) * 100) }))
    .filter((t) => t.pct >= 3);

  const lines: string[] = [];
  lines.push(`${best.club.club} goes about ${fmt(best.club.total)}${best.club.source === 'tracked' ? ' (from your tracked shots)' : best.club.source === 'mine' ? ' (your distance)' : ''}; here it flies ${fmt(best.carryReal)}.`);
  if (eff && eff.label !== 'Calm') {
    const parts: string[] = [];
    if (Math.abs(eff.head) >= 3) parts.push(`${Math.round(Math.abs(eff.head))} km/h ${eff.head > 0 ? 'into you' : 'behind you'}`);
    if (Math.abs(eff.cross) >= 3) parts.push(`${Math.round(Math.abs(eff.cross))} km/h ${eff.cross > 0 ? 'left to right' : 'right to left'}`);
    if (parts.length) lines.push(`Wind: ${parts.join(' and ')}.`);
  }
  // Trouble in play, described from the green (approach) or the landing zone (tee shot)
  const ref = mode === 'approach' ? pinRel : toLocal(from, best.landing.centre);
  const refDist = Math.hypot(ref.x, ref.y);
  for (const kind of ['water', 'bunker'] as const) {
    const pct = Math.round((best.trouble[kind] ?? 0) * 100);
    const nearest = geo.hazards
      .filter((z) => z.kind === kind)
      .map((z) => {
        const c = z.poly.reduce((acc, p) => ({ lat: acc.lat + p.lat / z.poly.length, lon: acc.lon + p.lon / z.poly.length }), { lat: 0, lon: 0 });
        return { c, d: distanceM(c, fromLocal(from, ref.x, ref.y)) };
      })
      .filter((e) => e.d < 45)
      .sort((x, y) => x.d - y.d)[0];
    if (!nearest || pct < 2) continue;
    const rel = toLocal(from, nearest.c);
    const hs = (rel.x - ref.x) * uy - (rel.y - ref.y) * ux;
    const hd = rel.x * ux + rel.y * uy - refDist;
    const where = [Math.abs(hd) < 8 ? '' : hd < 0 ? 'short' : 'long', Math.abs(hs) < 5 ? '' : hs > 0 ? 'right' : 'left'].filter(Boolean).join(' and ') || 'in the way';
    const of = mode === 'approach' ? 'of the green' : 'of where it lands';
    lines.push(`${kind === 'water' ? 'Water' : 'Bunker'} ${where === 'in the way' ? where : `${where} ${of}`}: ${pct}% chance of finding it on this line.`);
  }
  lines.push(...tend.notes);
  if (mood.note) lines.push(mood.note);
  if (alt) {
    const diff = alt.ev - best.ev;
    if (Math.abs(diff) >= 0.03) {
      const altTrouble = Math.round(((alt.trouble.water ?? 0) + (alt.trouble.bunker ?? 0)) * 100);
      lines.push(
        diff > 0
          ? `${alt.club.club} costs about ${diff.toFixed(2)} shots on average${altTrouble ? ` (${altTrouble}% in trouble)` : ''}.`
          : `${alt.club.club} averages ${(-diff).toFixed(2)} shots better but brings more trouble in. This is the percentage play today.`,
      );
    }
  }

  return {
    mode,
    from,
    toPin,
    best,
    alt,
    headline: best.club.club,
    aimText,
    lines,
    trouble,
    playsLike: plPin.distance,
  };
}

/** An ellipse outline (for the map) showing where ~70% of shots will finish. */
export function landingEllipse(o: Option['landing'], from: LatLon): LatLon[] {
  const c = toLocal(from, o.centre);
  const b = (o.bearing * Math.PI) / 180;
  const ux = Math.sin(b),
    uy = Math.cos(b);
  const pts: LatLon[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const along = Math.cos(a) * o.sdLong * 1.1;
    const side = Math.sin(a) * o.sdLat * 1.1;
    pts.push(fromLocal(from, c.x + ux * along + uy * side, c.y + uy * along - ux * side));
  }
  return pts;
}
