import type { ApproachMiss, Hole, HoleStats, Round } from '../types';
import { distanceM } from './geo';

/** Rough amateur benchmarks per 18 holes, by handicap. Interpolated between bands. */
const BANDS = [
  { h: 0, putts: 30, gir: 11, fir: 0.6, threePutts: 0.8, penalties: 0.5, scramble: 0.5, doubles: 0.5 },
  { h: 10, putts: 32, gir: 7, fir: 0.52, threePutts: 1.8, penalties: 1.2, scramble: 0.3, doubles: 1.8 },
  { h: 20, putts: 34, gir: 3.5, fir: 0.45, threePutts: 3, penalties: 2.2, scramble: 0.18, doubles: 4 },
  { h: 30, putts: 36, gir: 1.5, fir: 0.38, threePutts: 4.2, penalties: 3.5, scramble: 0.1, doubles: 7 },
  { h: 45, putts: 38, gir: 0.5, fir: 0.3, threePutts: 5.5, penalties: 5, scramble: 0.05, doubles: 10 },
];
export type Benchmark = Omit<(typeof BANDS)[number], 'h'>;

export function benchmarkFor(handicap: number): Benchmark {
  const h = Math.max(0, Math.min(45, handicap));
  for (let i = 1; i < BANDS.length; i++) {
    const a = BANDS[i - 1];
    const b = BANDS[i];
    if (h <= b.h) {
      const t = (h - a.h) / (b.h - a.h);
      const lerp = (k: keyof Benchmark) => a[k] + (b[k] - a[k]) * t;
      return {
        putts: lerp('putts'),
        gir: lerp('gir'),
        fir: lerp('fir'),
        threePutts: lerp('threePutts'),
        penalties: lerp('penalties'),
        scramble: lerp('scramble'),
        doubles: lerp('doubles'),
      };
    }
  }
  const { h: _h, ...rest } = BANDS[BANDS.length - 1];
  void _h;
  return rest;
}

export interface HoleLine {
  hole: Hole;
  gross: number;
  over: number;
  stats: HoleStats;
  gir?: boolean;
  scrambleChance: boolean;
  scrambled: boolean;
}

export interface RoundStats {
  holesPlayed: number;
  gross: number;
  toPar: number;
  putts: number;
  puttsRecorded: number;
  threePutts: number;
  onePutts: number;
  fairwaysHit: number;
  fairwayChances: number;
  missLeft: number;
  missRight: number;
  gir: number;
  girKnown: number;
  scrambles: number;
  scrambleChances: number;
  penalties: number;
  sandHoles: number;
  sandSaves: number;
  birdiesOrBetter: number;
  pars: number;
  bogeys: number;
  doublesPlus: number;
  parAvg: Record<3 | 4 | 5, { avg: number; n: number }>;
  frontToPar: number;
  backToPar: number;
  approachMisses: Record<ApproachMiss, number>;
  lines: HoleLine[];
}

export function holeLines(round: Round): HoleLine[] {
  const scores = round.scores[round.meId] ?? {};
  const lines: HoleLine[] = [];
  for (const hole of round.holes) {
    const gross = scores[hole.number];
    if (!gross) continue;
    const stats = round.stats[hole.number] ?? {};
    const gir = stats.putts != null ? gross - stats.putts <= hole.par - 2 : undefined;
    const scrambleChance = gir === false;
    const scrambled = scrambleChance && gross <= hole.par;
    lines.push({ hole, gross, over: gross - hole.par, stats, gir, scrambleChance, scrambled });
  }
  return lines;
}

export function roundStats(round: Round): RoundStats {
  const lines = holeLines(round);
  const s: RoundStats = {
    holesPlayed: lines.length,
    gross: 0,
    toPar: 0,
    putts: 0,
    puttsRecorded: 0,
    threePutts: 0,
    onePutts: 0,
    fairwaysHit: 0,
    fairwayChances: 0,
    missLeft: 0,
    missRight: 0,
    gir: 0,
    girKnown: 0,
    scrambles: 0,
    scrambleChances: 0,
    penalties: 0,
    sandHoles: 0,
    sandSaves: 0,
    birdiesOrBetter: 0,
    pars: 0,
    bogeys: 0,
    doublesPlus: 0,
    parAvg: { 3: { avg: 0, n: 0 }, 4: { avg: 0, n: 0 }, 5: { avg: 0, n: 0 } },
    frontToPar: 0,
    backToPar: 0,
    approachMisses: { short: 0, long: 0, left: 0, right: 0 },
    lines,
  };
  const parSums: Record<number, number> = { 3: 0, 4: 0, 5: 0 };
  for (const l of lines) {
    const { hole, gross, stats } = l;
    s.gross += gross;
    s.toPar += l.over;
    if (hole.number <= 9) s.frontToPar += l.over;
    else s.backToPar += l.over;
    if (l.over <= -1) s.birdiesOrBetter++;
    else if (l.over === 0) s.pars++;
    else if (l.over === 1) s.bogeys++;
    else s.doublesPlus++;
    const pk = (hole.par <= 3 ? 3 : hole.par >= 5 ? 5 : 4) as 3 | 4 | 5;
    parSums[pk] += gross;
    s.parAvg[pk].n++;
    if (stats.putts != null) {
      s.putts += stats.putts;
      s.puttsRecorded++;
      if (stats.putts >= 3) s.threePutts++;
      if (stats.putts === 1) s.onePutts++;
    }
    if (hole.par >= 4 && stats.fairway && stats.fairway !== 'na') {
      s.fairwayChances++;
      if (stats.fairway === 'hit') s.fairwaysHit++;
      if (stats.fairway === 'left') s.missLeft++;
      if (stats.fairway === 'right') s.missRight++;
    }
    if (l.gir != null) {
      s.girKnown++;
      if (l.gir) s.gir++;
    }
    if (l.scrambleChance) {
      s.scrambleChances++;
      if (l.scrambled) s.scrambles++;
    }
    s.penalties += stats.penalties ?? 0;
    if ((stats.sand ?? 0) > 0) {
      s.sandHoles++;
      if (gross <= hole.par) s.sandSaves++;
    }
    if (stats.approachMiss && l.gir === false) s.approachMisses[stats.approachMiss]++;
  }
  for (const k of [3, 4, 5] as const) {
    s.parAvg[k].avg = s.parAvg[k].n ? parSums[k] / s.parAvg[k].n : 0;
  }
  return s;
}

export interface FocusArea {
  id: string;
  title: string;
  /** Estimated strokes this cost you versus a typical golfer of your handicap. */
  strokes: number;
  detail: string;
  holes: number[];
  drill: string;
  onCourse: string;
}

export interface CostlyHole {
  number: number;
  par: number;
  gross: number;
  over: number;
  reasons: string[];
}

export interface Coaching {
  stats: RoundStats;
  benchmark: Benchmark;
  handicap: number;
  focus: FocusArea[];
  positives: string[];
  costliest: CostlyHole[];
  summary: string;
  practicePlan: { minutes: number; what: string }[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

function holeReasons(l: HoleLine): string[] {
  const out: string[] = [];
  const st = l.stats;
  if (st.penalties) out.push(`${st.penalties} penalty stroke${st.penalties > 1 ? 's' : ''}`);
  if (l.hole.par >= 4 && (st.fairway === 'left' || st.fairway === 'right')) out.push(`missed fairway ${st.fairway}`);
  if (l.gir === true && (st.putts ?? 0) >= 3) out.push(`hit the green in regulation but ${st.putts}-putted`);
  else if ((st.putts ?? 0) >= 3) out.push(`${st.putts} putts`);
  if (l.gir === false && st.approachMiss) out.push(`approach missed ${st.approachMiss}`);
  if ((st.sand ?? 0) > 0) out.push(`${st.sand} bunker shot${st.sand! > 1 ? 's' : ''}`);
  if (l.scrambleChance && !l.scrambled && (st.putts ?? 0) <= 2 && l.over >= 1) out.push('no up & down');
  if (!out.length) out.push('no stats recorded; add putts/fairway next time for a sharper read');
  return out;
}

export function coach(round: Round, handicap: number): Coaching {
  const stats = roundStats(round);
  const n = stats.holesPlayed || 1;
  const scale = n / 18;
  const bm = benchmarkFor(handicap);
  const focus: FocusArea[] = [];
  const lines = stats.lines;

  // --- Putting
  if (stats.puttsRecorded) {
    const exp3 = bm.threePutts * (stats.puttsRecorded / 18);
    const expPutts = bm.putts * (stats.puttsRecorded / 18);
    const extra3 = stats.threePutts - exp3;
    const extraPutts = stats.putts - expPutts;
    const lost = Math.max(extra3, extraPutts * 0.8);
    if (lost > 0.6) {
      const girThree = lines.filter((l) => l.gir && (l.stats.putts ?? 0) >= 3).map((l) => l.hole.number);
      const threes = lines.filter((l) => (l.stats.putts ?? 0) >= 3).map((l) => l.hole.number);
      const longFirst = lines.filter((l) => (l.stats.firstPuttM ?? 0) >= 8 && (l.stats.putts ?? 0) >= 3).length;
      focus.push({
        id: 'putting',
        title: 'Lag putting & speed control',
        strokes: r1(lost),
        holes: threes,
        detail:
          `${stats.putts} putts over ${stats.puttsRecorded} holes (a ${Math.round(handicap)} marker averages about ${Math.round(expPutts)}), with ${stats.threePutts} three-putt${stats.threePutts === 1 ? '' : 's'}.` +
          (girThree.length
            ? ` On hole${girThree.length > 1 ? 's' : ''} ${girThree.join(', ')} you did the hard work hitting the green in regulation, then handed the shot straight back with the flat stick.`
            : '') +
          (longFirst ? ` ${longFirst} of those started from 8 m+, so it's distance control, not the short ones.` : ''),
        drill:
          'Ladder drill: from 6, 9, 12 and 15 m, roll 3 balls each to finish inside a club-length past the hole. Don\'t move back until all 3 finish in the zone. Then 20 x 1 m putts in a circle to lock in the tidy-ups.',
        onCourse:
          'On anything outside 8 m, your only job is pace: pick a 1 m circle around the hole and aim to die it in there. Walk the putt and feel the slope before you hit it.',
      });
    }
  }

  // --- Penalties
  const expPen = bm.penalties * scale;
  if (stats.penalties - expPen > 0.5) {
    const holes = lines.filter((l) => (l.stats.penalties ?? 0) > 0).map((l) => l.hole.number);
    focus.push({
      id: 'penalties',
      title: 'Cut out the penalty shots',
      strokes: r1((stats.penalties - expPen) * 1.3),
      holes,
      detail: `${stats.penalties} penalty stroke${stats.penalties === 1 ? '' : 's'} (holes ${holes.join(', ')}). Each one usually costs more than a shot once you count the recovery.`,
      drill:
        'Fairway gates on the range: pick two targets 30 m apart and hit 10 drivers then 10 of your "safe" club (3-wood/hybrid). Score how many finish inside. Learn which club keeps you in play under pressure.',
      onCourse:
        'Where there\'s OB or water within reach, take the club that can\'t get there, even if it leaves a longer approach. Aim away from the trouble side, not at the middle.',
    });
  }

  // --- Driving accuracy & miss bias
  if (stats.fairwayChances >= 4) {
    const missed = stats.fairwayChances - stats.fairwaysHit;
    const expMissed = stats.fairwayChances * (1 - bm.fir);
    const missedHurt = lines.filter(
      (l) => (l.stats.fairway === 'left' || l.stats.fairway === 'right') && l.over >= 1,
    );
    const lost = (missed - expMissed) * 0.35 + missedHurt.filter((l) => l.over >= 2).length * 0.3;
    if (lost > 0.6) {
      const bias =
        stats.missRight > stats.missLeft * 1.5
          ? 'right'
          : stats.missLeft > stats.missRight * 1.5
            ? 'left'
            : undefined;
      focus.push({
        id: 'driving',
        title: bias ? `Tee shots leaking ${bias}` : 'Find more fairways',
        strokes: r1(lost),
        holes: missedHurt.map((l) => l.hole.number),
        detail:
          `${stats.fairwaysHit}/${stats.fairwayChances} fairways (${pct(stats.fairwaysHit, stats.fairwayChances)}%; typical for your handicap is ~${Math.round(bm.fir * 100)}%). Misses: ${stats.missLeft} left, ${stats.missRight} right.` +
          (bias === 'right'
            ? ' A consistent right miss (for a right-hander) usually means an open clubface at impact or an out-to-in path.'
            : bias === 'left'
              ? ' A consistent left miss usually means the face is closing too fast, often from a strong grip or the hands flipping.'
              : ''),
        drill:
          bias === 'right'
            ? 'Headcover drill: place a headcover just outside and behind the ball. Swing without hitting it to train an in-to-out path. 20 balls, then 10 at 70% pace focusing on a square face.'
            : bias === 'left'
              ? 'Hold-off drill: hit 20 balls at 70% pace feeling the back of your lead hand face the target longer through impact. Check your grip isn\'t too strong (no more than 2 knuckles showing).'
              : 'Alignment-stick routine: lay a stick on your target line and hit 20 drivers with a full pre-shot routine. Accuracy before speed.',
        onCourse:
          bias
            ? `Tee up on the ${bias} side of the box and aim down the ${bias} edge of the fairway so your normal miss still finishes in play.`
            : 'Pick a small target (a tree, a bunker edge) rather than "the fairway". On tight holes, hit the club you trust most.',
      });
    }
  }

  // --- Approach / GIR
  if (stats.girKnown >= 6) {
    const expGir = bm.gir * (stats.girKnown / 18);
    const lostGir = (expGir - stats.gir) * 0.5;
    if (lostGir > 0.6) {
      const m = stats.approachMisses;
      const dom = (Object.entries(m) as [ApproachMiss, number][]).sort((a, b) => b[1] - a[1])[0];
      const missed = lines.filter((l) => l.gir === false).map((l) => l.hole.number);
      focus.push({
        id: 'approach',
        title: dom && dom[1] >= 2 && dom[0] === 'short' ? 'Approaches coming up short' : 'Approach play / greens in regulation',
        strokes: r1(lostGir),
        holes: missed,
        detail:
          `${stats.gir}/${stats.girKnown} greens in regulation (typical for you: ~${r1(expGir)}).` +
          (dom && dom[1] >= 2 ? ` Your most common miss was ${dom[0]} (${dom[1]} times).` : '') +
          (dom && dom[0] === 'short' && dom[1] >= 2
            ? ' Short is the classic amateur miss: most of us club off our best-ever shot, not our average.'
            : ''),
        drill:
          'Carry-distance check: hit 10 balls with each iron and note the AVERAGE carry, not the best. Then play "9 greens" on the range: alternate clubs to different flags and count how many would\'ve found the putting surface.',
        onCourse:
          dom && dom[0] === 'short'
            ? 'Take one more club than you think and aim at the middle of the green. Use the app\'s "plays like" number: it\'s already adjusted for the wind.'
            : 'Aim for the fat part of the green, not the flag, unless you\'ve got a wedge in hand. Use the "back" number when there\'s trouble long.',
      });
    }
  }

  // --- Short game / scrambling
  if (stats.scrambleChances >= 4) {
    const exp = bm.scramble * stats.scrambleChances;
    const lost = (exp - stats.scrambles) * 0.7;
    if (lost > 0.6) {
      const failed = lines.filter((l) => l.scrambleChance && !l.scrambled).map((l) => l.hole.number);
      focus.push({
        id: 'shortgame',
        title: 'Getting up & down',
        strokes: r1(lost),
        holes: failed,
        detail: `You got up & down ${stats.scrambles} of ${stats.scrambleChances} times you missed the green (${pct(stats.scrambles, stats.scrambleChances)}%; typical for your handicap ~${Math.round(bm.scramble * 100)}%).`,
        drill:
          'Up-and-down game: drop 9 balls around a practice green (3 easy, 3 medium, 3 nasty lies). Chip and putt out each one. Record your score; beat it next session. Use one go-to club (e.g. 8-iron bump-and-run) wherever the ground allows.',
        onCourse:
          'Get the ball rolling as early as possible: putt from the fringe, bump-and-run before you flop. Pick a landing spot one pace onto the green.',
      });
    }
  }

  // --- Bunkers
  if (stats.sandHoles >= 2 && stats.sandSaves / stats.sandHoles < 0.25) {
    const holes = lines.filter((l) => (l.stats.sand ?? 0) > 0).map((l) => l.hole.number);
    focus.push({
      id: 'bunker',
      title: 'Bunker play',
      strokes: r1((stats.sandHoles - stats.sandSaves) * 0.4),
      holes,
      detail: `${stats.sandSaves}/${stats.sandHoles} sand saves.`,
      drill:
        'Line drill: draw a line in the sand, and hit 20 shots aiming to enter the sand on the line or just behind it with an open face. Once it\'s consistent, add a ball 5 cm in front of the line.',
      onCourse: 'Open the face before you take your grip, feet dug in, and commit to a full follow-through. Pick the safe side of the green.',
    });
  }

  // --- Blow-up holes
  const expDoubles = bm.doubles * scale;
  if (stats.doublesPlus - expDoubles > 0.8) {
    const blow = lines.filter((l) => l.over >= 2);
    const extra = blow.reduce((s, l) => s + (l.over - 1), 0);
    focus.push({
      id: 'damage',
      title: 'Damage control on blow-up holes',
      strokes: r1(Math.min(extra, (stats.doublesPlus - expDoubles) * 1.2)),
      holes: blow.map((l) => l.hole.number),
      detail: `${stats.doublesPlus} double bogeys or worse (holes ${blow.map((l) => `${l.hole.number} (${l.gross})`).join(', ')}). Turning those into bogeys is the fastest way to drop shots.`,
      drill:
        'Trouble-shot practice: once a session, hit 10 punch-outs: low 7-iron under an imaginary branch, finishing in a target zone 80 to 120 m away.',
      onCourse:
        'After a bad shot, take your medicine: get back to the fairway in one, accept bogey and move on. Hero shots out of trees are where doubles become triples.',
    });
  }

  // --- Par 5 strategy
  const p5 = stats.parAvg[5];
  const p4 = stats.parAvg[4];
  if (p5.n >= 2 && p4.n >= 2 && p5.avg - 5 > p4.avg - 4 + 0.4) {
    const holes = lines.filter((l) => l.hole.par >= 5).map((l) => l.hole.number);
    focus.push({
      id: 'par5',
      title: 'Par 5 strategy',
      strokes: r1((p5.avg - 5 - (p4.avg - 4)) * p5.n * 0.7),
      holes,
      detail: `You averaged ${r1(p5.avg)} on par 5s (${toPar(p5.avg - 5)}) versus ${r1(p4.avg)} on par 4s (${toPar(p4.avg - 4)}). Par 5s should be your scoring holes.`,
      drill: 'Know your "full wedge" distance cold: hit 20 balls with your favourite wedge and note the average carry.',
      onCourse:
        'Plan backwards: lay up to your favourite full-wedge distance instead of hitting a long club "as far as possible". A wedge from 90 m beats a chip from a bad lie at 30 m.',
    });
  }

  // --- Back nine fade
  if (n >= 18 && stats.backToPar - stats.frontToPar >= 4) {
    focus.push({
      id: 'stamina',
      title: 'Back-nine fade',
      strokes: r1((stats.backToPar - stats.frontToPar) * 0.5),
      holes: lines.filter((l) => l.hole.number > 9 && l.over >= 2).map((l) => l.hole.number),
      detail: `Front nine ${toPar(stats.frontToPar)}, back nine ${toPar(stats.backToPar)}. That's ${stats.backToPar - stats.frontToPar} shots worse coming home.`,
      drill: 'Practise with a routine, not a bucket: play the last 20 balls of each session as "pressure shots" with a full pre-shot routine.',
      onCourse:
        'Eat something at the turn, drink water every few holes, and reset your routine on the 10th tee as if it\'s a new round.',
    });
  }

  focus.sort((a, b) => b.strokes - a.strokes);

  // --- Positives
  const positives: string[] = [];
  if (stats.puttsRecorded && stats.threePutts === 0) positives.push('No three-putts. Great speed control on the greens.');
  if (stats.fairwayChances >= 4 && stats.fairwaysHit / stats.fairwayChances >= bm.fir + 0.1)
    positives.push(`Driving was a strength: ${pct(stats.fairwaysHit, stats.fairwayChances)}% fairways hit.`);
  if (stats.girKnown >= 6 && stats.gir >= bm.gir * (stats.girKnown / 18) + 1)
    positives.push(`Iron play was solid with ${stats.gir} greens in regulation.`);
  if (stats.scrambleChances >= 3 && stats.scrambles / stats.scrambleChances >= bm.scramble + 0.15)
    positives.push(`Short game saved you: ${stats.scrambles} up & downs.`);
  if (stats.penalties === 0 && n >= 9) positives.push('Zero penalty shots. You kept it in play all day.');
  if (stats.birdiesOrBetter) positives.push(`${stats.birdiesOrBetter} birdie${stats.birdiesOrBetter > 1 ? 's' : ''} or better. Ripper.`);
  if (stats.onePutts >= 4) positives.push(`${stats.onePutts} one-putts.`);

  // --- Costliest holes
  const costliest = [...lines]
    .filter((l) => l.over >= 1)
    .sort((a, b) => b.over - a.over || a.hole.si - b.hole.si)
    .slice(0, 5)
    .map((l) => ({ number: l.hole.number, par: l.hole.par, gross: l.gross, over: l.over, reasons: holeReasons(l) }));

  // --- Practice plan: split 60 minutes across the top focus areas
  const top = focus.slice(0, 3);
  const totalW = top.reduce((s, f) => s + f.strokes, 0);
  const practicePlan = top.length
    ? top.map((f) => ({ minutes: Math.max(10, Math.round(((f.strokes / totalW) * 60) / 5) * 5), what: `${f.title}: ${f.drill}` }))
    : [{ minutes: 60, what: 'Balanced session: 20 min putting (lag + 1 m), 20 min chipping, 20 min full swing with a pre-shot routine.' }];

  const totalLost = r1(focus.reduce((s, f) => s + f.strokes, 0));
  const summary = focus.length
    ? `Shot ${stats.gross} (${toPar(stats.toPar)}) over ${n} holes. Compared with a typical ${Math.round(handicap)} marker, about ${totalLost} shots went missing, mostly from ${focus
        .slice(0, 2)
        .map((f) => f.title.toLowerCase())
        .join(' and ')}.`
    : `Shot ${stats.gross} (${toPar(stats.toPar)}) over ${n} holes, right on or better than the benchmark for a ${Math.round(handicap)} marker. Keep doing what you're doing.`;

  return { stats, benchmark: bm, handicap, focus, positives, costliest, summary, practicePlan };
}

export function toPar(n: number): string {
  const v = r1(n);
  if (v === 0) return 'E';
  return v > 0 ? `+${v}` : `${v}`;
}

/** Average carry per club from GPS-marked shots across rounds. */
export function clubDistances(rounds: Round[]): { club: string; avg: number; n: number; max: number }[] {
  const acc: Record<string, number[]> = {};
  for (const r of rounds) {
    for (const [holeNo, shots] of Object.entries(r.shots ?? {})) {
      const hole = r.holes.find((h) => h.number === Number(holeNo));
      for (let i = 0; i < shots.length; i++) {
        const s = shots[i];
        if (!s.club || /putt/i.test(s.club)) continue;
        const next = shots[i + 1] ?? (hole?.green ? { ...hole.green.centre } : undefined);
        if (!next) continue;
        const d = distanceM(s, next);
        if (d < 5 || d > 350) continue;
        (acc[s.club] ??= []).push(d);
      }
    }
  }
  return Object.entries(acc)
    .map(([club, ds]) => ({ club, n: ds.length, avg: ds.reduce((a, b) => a + b, 0) / ds.length, max: Math.max(...ds) }))
    .sort((a, b) => b.avg - a.avg);
}

/** Trend data for the last N completed rounds. */
export function trends(rounds: Round[], handicap: number) {
  return rounds
    .filter((r) => r.completed)
    .sort((a, b) => a.startedAt - b.startedAt)
    .slice(-10)
    .map((r) => {
      const c = coach(r, handicap);
      const s = c.stats;
      return {
        id: r.id,
        date: r.date,
        course: r.courseName,
        holes: s.holesPlayed,
        toPar: s.toPar,
        putts18: s.puttsRecorded ? (s.putts / s.puttsRecorded) * 18 : undefined,
        fir: s.fairwayChances ? s.fairwaysHit / s.fairwayChances : undefined,
        gir18: s.girKnown ? (s.gir / s.girKnown) * 18 : undefined,
        penalties: s.penalties,
        topFocus: c.focus[0]?.title,
      };
    });
}
