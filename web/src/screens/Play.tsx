import { useEffect, useMemo, useRef, useState } from 'react';
import type { FairwayResult, HoleStats, LatLon, Round } from '../types';
import { useSiriMarks } from '../live/siriChannel';
import { RoundReplay } from '../components/RoundReplay';
import { usePinShare, withPin } from '../live/pinShare';
import { store } from '../lib/storage';
import { distanceM, fmtDist, greenDistances } from '../lib/geo';
import { fetchElevations, fetchWeather, playsLike, windEffect } from '../lib/weather';
import { computeResult, sidesFor } from '../lib/scoring';
import { strokesByHole } from '../lib/handicap';
import { useGeolocation, useWakeLock } from '../hooks';
import { HoleMap } from '../components/HoleMap';
import { HoleView } from '../components/HoleView';
import { LiveControl, pushFinal } from '../live/LiveControl';
import { useLiveField } from '../live/useLiveField';
import { assignMarkers, sideKeys, type MarkerPhone } from '../lib/markers';
import { personKey } from '../lib/share';
import { aidsFor, AIDS_LABELS } from '../lib/comps';
import { fetchGreenDem, inQueensland, type Dem } from '../lib/greenDem';
import { ESRI, QLD_AERIAL } from '../lib/holeFrame';
import { approachNote, smooth } from '../lib/greenRead';
import { Scorecard } from '../components/Scorecard';
import { Card, Header, Segmented, Stepper, scoreClass, type Go } from '../components/ui';
import { CaddyCard } from '../components/CaddyCard';
import { advise, buildBag, roundMood, tendencies, type Advice } from '../lib/caddy';

// The caddy plays each option a few hundred times; only re-think when something changes
let caddyCache: { key: string; value: Advice | null } = { key: '', value: null };

export function Play({ go, roundId }: { go: Go; roundId: string }) {
  const [round, setRound] = useState<Round | undefined>(() => store.round(roundId));
  const [idx, setIdx] = useState(() => {
    const r = store.round(roundId);
    if (!r) return 0;
    const me = r.scores[r.meId] ?? {};
    const first = r.holes.findIndex((h) => me[h.number] == null);
    return first < 0 ? r.holes.length - 1 : first;
  });
  const [tab, setTab] = useState<'hole' | 'card'>('hole');
  const [mapMode, setMapMode] = useState<'measure' | 'pin'>('measure');
  const [measure, setMeasure] = useState<LatLon | undefined>();
  const [club, setClub] = useState<string>('Driver');
  const [wxErr, setWxErr] = useState<string | null>(null);
  const [caddyOnMap, setCaddyOnMap] = useState(true);
  const [elev, setElev] = useState<{ at: LatLon; hole: number; diff: number } | null>(null);
  const settings = store.settings();
  const units = settings.units;
  const geo = useGeolocation(true);
  useWakeLock(true);

  const update = (fn: (r: Round) => Round) => {
    setRound((prev) => {
      if (!prev) return prev;
      const next = fn(structuredClone(prev));
      store.saveRound(next);
      return next;
    });
  };

  const hole = round?.holes[idx];
  const [courseRev, setCourseRev] = useState(0);
  const course = useMemo(
    () => (round ? store.courses().find((c) => c.id === round.courseId) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [round?.courseId, courseRev],
  );
  // Stand at the pin, then at your ball: GPS-averaged marks for the putt read
  const [spotMark, setSpotMark] = useState<{ what: 'pin' | 'ball' | null; note?: string }>({ what: null });
  const markHere = async (what: 'pin' | 'ball') => {
    const h = round?.holes[idx];
    if (!h) return;
    setSpotMark({ what, note: undefined });
    try {
      const { sampleFix } = await import('../lib/spotMark');
      const other = what === 'ball' ? round?.pins[h.number] : round?.balls?.[h.number];
      const fix = await sampleFix(5000, geo.pos ? { pos: geo.pos, acc: geo.accuracy ?? 8 } : undefined, other);
      if (fix.stale) {
        setSpotMark({ what: null, note: `The GPS hasn't caught up with you yet (it's still showing the ${what === 'ball' ? 'pin' : 'ball'}). Wait 10 seconds and tap again, or tap the map where your ${what === 'ball' ? 'ball' : 'pin'} is.` });
        return;
      }
      const note = fix.acc > 6 ? `GPS ±${Math.round(fix.acc)} m: a rough read` : `GPS ±${Math.round(fix.acc)} m`;
      update((r) =>
        what === 'pin'
          ? withPin(r, h.number, fix.pos)
          : { ...r, balls: { ...(r.balls ?? {}), [h.number]: fix.pos } },
      );
      setMeasure(undefined);
      setSpotMark({ what: null, note: what === 'pin' ? `Pin marked (${note}). Now walk to your ball.` : note });
    } catch (e) {
      setSpotMark({ what: null, note: e instanceof Error ? e.message : String(e) });
    }
  };

  // "Hey Siri, mark shot": spots marked with the phone in the pocket drop into the right holes
  const [siriNote, setSiriNote] = useState<string | null>(null);
  const [replayOpen, setReplayOpen] = useState(false);
  useSiriMarks(round?.trackShots === false ? undefined : round, course?.holes ?? round?.holes ?? [], update, (added) => {
    const holes = [...new Set(added.map((a) => a.hole))];
    setSiriNote(
      added.length === 1
        ? `🎙️ Siri shot added on hole ${added[0].hole}${added[0].club ? ` (${added[0].club})` : ''}`
        : `🎙️ ${added.length} shots from Siri added on hole${holes.length > 1 ? 's' : ''} ${holes.join(', ')}`,
    );
  });
  // Pins are shared across the field: whoever marks one, everyone gets it
  usePinShare(round, settings.me.name, update, (by, h) => setSiriNote(`📍 ${by} marked the pin on hole ${h}`));
  useEffect(() => {
    if (!siriNote) return;
    const t = setTimeout(() => setSiriNote(null), 6000);
    return () => clearTimeout(t);
  }, [siriNote]);
  // Saved courses: pick up corrected pars, stroke indexes, bunkers, water and doglegs from the built-in list.
  // A round in progress follows the corrected card (pars and stroke indexes) too.
  const refreshed = useRef(false);
  useEffect(() => {
    if (!course?.osmRef || refreshed.current) return;
    refreshed.current = true;
    let stop = false;
    import('../lib/courseCatalog')
      .then(({ refreshCourse }) => refreshCourse(course))
      .then((fresh) => {
        if (stop || !fresh) return;
        store.saveCourse(fresh);
        setCourseRev((n) => n + 1);
        update((r) => {
          if (r.completed || r.courseId !== fresh.id) return r;
          const holes = r.holes.map((h) => {
            const f = fresh.holes.find((x) => x.number === h.number);
            return f ? { ...h, par: f.par, si: f.si, parEst: f.parEst, siEst: f.siEst } : h;
          });
          return { ...r, holes };
        });
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course]);

  // --- Weather: fetch on start and every 10 minutes
  const wxAt = geo.pos ?? course?.location ?? hole?.green?.centre;
  const wxAtRef = useRef(wxAt);
  wxAtRef.current = wxAt;
  const haveAt = !!wxAt;
  useEffect(() => {
    if (!haveAt) return;
    let stop = false;
    const load = () =>
      fetchWeather(wxAtRef.current!)
        .then((w) => {
          if (stop) return;
          setWxErr(null);
          update((r) => ({ ...r, weather: w }));
        })
        .catch((e) => !stop && setWxErr(e instanceof Error ? e.message : String(e)));
    const stale = !round?.weather || Date.now() - round.weather.t > 10 * 60 * 1000;
    if (stale) load();
    const t = setInterval(load, 10 * 60 * 1000);
    return () => {
      stop = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [haveAt]);

  // --- Elevation change to the target (refresh when you've moved 25 m+)
  const pin = hole ? round?.pins[hole.number] : undefined;
  const target = pin ?? hole?.green?.centre;
  useEffect(() => {
    if (!geo.pos || !target || !hole) return;
    if (elev && elev.hole === hole.number && distanceM(elev.at, geo.pos) < 25) return;
    const at = geo.pos;
    fetchElevations([at, target])
      .then(([a, b]) => setElev({ at, hole: hole.number, diff: b - a }))
      .catch(() => setElev({ at, hole: hole.number, diff: 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.pos, target, hole?.number]);

  const strokeMap = useMemoStrokes(round);
  // Other groups in the same live event (e.g. the other Ambrose team), for the scorecard
  const live = useLiveField(round);
  const [cardView, setCardView] = useState<'field' | 'group'>('field');
  // Cross-marking: with two or more phones on this card, each marks the other side, never its own
  const marking = useMemo(() => {
    if (!round?.liveGroup) return null;
    const host = round.liveSameAs ?? round.liveGroup;
    const myName = store.settings().me.name;
    const others = live.others.filter((g) => g.id !== round.liveGroup && g.bundle.rounds[0]);
    const mePhone: MarkerPhone = { group: round.liveGroup, owner: personKey(myName), name: myName };
    const phones: MarkerPhone[] = [];
    if (round.liveSameAs) {
      const h = others.find((g) => g.id === host);
      if (!h) return null;
      phones.push({ group: host, owner: personKey(h.bundle.from), name: h.bundle.from });
    } else phones.push(mePhone);
    const markers = others
      .filter((g) => g.bundle.rounds[0].liveSameAs === host)
      .map((g) => ({ group: g.id, owner: personKey(g.bundle.from), name: g.bundle.from }));
    if (round.liveSameAs) markers.push(mePhone);
    phones.push(...markers.sort((a, b) => (a.group < b.group ? -1 : 1)));
    const assign = assignMarkers(sideKeys(round), phones);
    return assign ? { assign, phones, others } : null;
  }, [round, live.others]);
  // Scores for the sides another phone marks come from that phone
  useEffect(() => {
    if (!round || !marking) return;
    const mine = sideKeys(round);
    const patch: Record<string, Record<number, number>> = {};
    for (const sk of mine) {
      const g = marking.assign[sk.id];
      if (!g || g === round.liveGroup) continue;
      const src = marking.others.find((o) => o.id === g)?.bundle.rounds[0];
      if (!src) continue;
      const match = sideKeys(src).find((x) => [...x.members].sort().join('|') === [...sk.members].sort().join('|'));
      const theirs = match ? src.scores[match.id] : undefined;
      if (theirs && JSON.stringify(theirs) !== JSON.stringify(round.scores[sk.id] ?? {})) patch[sk.id] = theirs;
    }
    if (Object.keys(patch).length) update((r) => ({ ...r, scores: { ...r.scores, ...patch } }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marking]);
  // Tournament rules from the comps this round counts towards (the organiser can change them live)
  const [rulesRev, setRulesRev] = useState(0);
  const compKey = (round?.compIds ?? []).join(',');
  useEffect(() => {
    if (!compKey) return;
    const unsubs: (() => void)[] = [];
    let stop = false;
    import('../live/compChannel')
      .then(async ({ watchJoiners, applyRules }) => {
        for (const id of compKey.split(',')) {
          const c = store.comp(id);
          if (!c) continue;
          const u = await watchJoiners(c, (_j, _l, rules) => {
            if (applyRules(store.comp(id) ?? c, rules)) setRulesRev((n) => n + 1);
          });
          if (stop) u();
          else unsubs.push(u);
        }
      })
      .catch(() => undefined);
    return () => {
      stop = true;
      unsubs.forEach((u) => u());
    };
  }, [compKey]);
  void rulesRev;
  // Ground heights for this green (Queensland LiDAR) for the slope map and the caddy's green read
  const holeGreen = round?.holes[idx]?.green;
  const greenKey = holeGreen ? `${holeGreen.centre.lat},${holeGreen.centre.lon}` : '';
  const [demState, setDemState] = useState<{ key: string; dem: Dem | null } | null>(null);
  useEffect(() => {
    if (!holeGreen) return;
    let stop = false;
    fetchGreenDem(holeGreen)
      .then((d) => !stop && setDemState({ key: greenKey, dem: d }))
      .catch(() => !stop && setDemState({ key: greenKey, dem: null }));
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [greenKey]);
  const dem = demState?.key === greenKey ? demState.dem : null;
  const demSmooth = useMemo(() => (dem ? smooth(dem) : null), [dem]);
  // Photos: the Queensland Government's sharper aerial imagery on Queensland courses, else Esri.
  // One tap swaps them (the two were taken at different times, so one may be more up to date).
  const [imageryPref, setImageryPref] = useState<'qld' | 'esri'>(() => {
    try {
      return localStorage.getItem('gtg.imagery') === 'esri' ? 'esri' : 'qld';
    } catch {
      return 'qld';
    }
  });
  const switchImagery = () => {
    const next = imageryPref === 'qld' ? 'esri' : 'qld';
    setImageryPref(next);
    try {
      localStorage.setItem('gtg.imagery', next);
    } catch {
      /* ignore */
    }
  };

  if (!round || !hole) {
    return (
      <div className="screen">
        <Header title="Round" onBack={() => go({ name: 'home' })} />
        <p className="content">Round not found.</p>
      </div>
    );
  }

  const sides = sidesFor(round);
  const me = round.meId;
  const stats: HoleStats = round.stats[hole.number] ?? {};
  const setStats = (patch: Partial<HoleStats>) =>
    update((r) => ({ ...r, stats: { ...r.stats, [hole.number]: { ...(r.stats[hole.number] ?? {}), ...patch } } }));
  const lockedBy = (sideId: string) => {
    const g = marking?.assign[sideId];
    return g && g !== round.liveGroup ? (marking!.phones.find((p) => p.group === g)?.name ?? 'another phone') : null;
  };
  const setScore = (sideId: string, v: number | undefined) => {
    if (lockedBy(sideId)) return;
    update((r) => {
      const s = { ...(r.scores[sideId] ?? {}) };
      if (v == null) delete s[hole.number];
      else s[hole.number] = v;
      return { ...r, scores: { ...r.scores, [sideId]: s } };
    });
    // Birdies and blow-ups go to the comp banter
    if (v != null && round.compIds?.length) import('../live/shoutouts').then((m) => m.queueShoutout(round.id, sideId, hole.number));
  };

  const dist = geo.pos && hole.green ? greenDistances(geo.pos, hole.green, pin) : undefined;
  const far = dist && dist.centre > 1200;
  const wx = round.weather;
  const effect = wx && dist ? windEffect(wx.windFromDeg, wx.windKmh, dist.bearing) : undefined;
  const elevDiff = elev && elev.hole === hole.number ? elev.diff : 0;
  const pl = dist ? playsLike(dist.pin, effect, elevDiff, wx?.tempC) : undefined;

  // ---- Caddy: from where you're standing, or from the tee when you're not on the hole yet
  const onHole = !!(geo.pos && hole.green && distanceM(geo.pos, hole.green.centre) < 700);
  const caddyFrom = onHole ? geo.pos : hole.tee;
  const mePlayer = round.players.find((p) => p.id === round.meId);
  const caddyHcp = mePlayer?.dailyHandicap ?? settings.me.gaHandicap;
  const rules = aidsFor(round.compIds, store.comps());
  const qldCourse = inQueensland(hole.green?.centre ?? course?.location ?? { lat: 0, lon: 0 });
  const caddyAllowed = rules.aids === 'full';
  const extrasAllowed = rules.aids !== 'distancesOnly';
  let advice: Advice | null = null;
  if (caddyAllowed && caddyFrom && hole.green) {
    const key = [
      round.id,
      hole.number,
      Math.round(caddyFrom.lat * 20000),
      Math.round(caddyFrom.lon * 20000),
      pin?.lat,
      pin?.lon,
      wx ? `${Math.round(wx.windKmh)}/${Math.round(wx.windFromDeg / 10)}` : '',
      onHole ? Math.round(elevDiff) : 0,
      Object.keys(round.scores[round.meId] ?? {}).length,
    ].join('|');
    if (caddyCache.key !== key) {
      let speed = 1;
      try {
        speed = Number(localStorage.getItem('gtg.tracerSpeed')) || 1;
      } catch {
        /* ignore */
      }
      const allRounds = store.rounds();
      caddyCache = {
        key,
        value: advise({
          // the round keeps its own copy of the holes; take the dogleg line from the course if it has one
          hole: { ...hole, path: hole.path ?? course?.holes.find((h) => h.number === hole.number)?.path },
          hazards: course?.hazards,
          pin,
          from: caddyFrom,
          bag: buildBag(settings, allRounds, caddyHcp, speed),
          cond: wx ? { windKmh: wx.windKmh, windFromDeg: wx.windFromDeg, tempC: wx.tempC, elevDiff: onHole ? elevDiff : 0 } : {},
          tend: tendencies(allRounds.filter((r) => r.id !== round.id), round),
          handicap: caddyHcp,
          mood: roundMood(round, hole.number),
          units,
        }),
      };
    }
    advice = caddyCache.value;
    // Add how the green falls around the pin, and where to miss
    if (advice && demSmooth && advice.toPin < 260) {
      const note = approachNote(demSmooth, pin ?? hole.green.centre, caddyFrom);
      if (note) advice = { ...advice, lines: [...advice.lines, `🟢 ${note}`] };
    }
  }
  const holeHazards = course?.hazards;
  const shots = round.shots[hole.number] ?? [];
  const lastShot = shots[shots.length - 1];
  const lastShotDist = lastShot && geo.pos ? distanceM(lastShot, geo.pos) : undefined;
  const result = computeResult(round);
  const meScore = round.scores[me]?.[hole.number];
  const gir = stats.putts != null && meScore != null ? meScore - stats.putts <= hole.par - 2 : undefined;
  const isLast = idx === round.holes.length - 1;

  const onMapTap = (p: LatLon) => {
    if (mapMode === 'pin') {
      update((r) => withPin(r, hole.number, p));
      setMapMode('measure');
    } else setMeasure(p);
  };

  const finish = () => {
    const missing = round.holes.filter((h) => round.scores[me]?.[h.number] == null).map((h) => h.number);
    if (missing.length && !confirm(`No score yet for hole${missing.length > 1 ? 's' : ''} ${missing.join(', ')}. Finish anyway?`)) return;
    update((r) => ({ ...r, completed: true, finishedAt: Date.now() }));
    pushFinal({ ...round, completed: true, finishedAt: Date.now() }, hole.number);
    // Handicaps kept from your rounds take this one in straight away
    setTimeout(() => import('../lib/appHandicapStore').then(({ refreshAppHandicaps }) => refreshAppHandicaps()).catch(() => undefined), 0);
    go({ name: 'summary', roundId: round.id });
  };

  return (
    <div className="screen play">
      {siriNote && (
        <button className="mate-toast" onClick={() => setSiriNote(null)}>
          {siriNote}
        </button>
      )}
      <Header
        title={round.courseName}
        onBack={() => go({ name: 'home' })}
        right={
          <button className="btn small" onClick={finish}>
            Finish
          </button>
        }
      />
      {!(tab === 'hole' && hole.green) && (
      <div className="hole-bar">
        <button className="icon-btn" disabled={idx === 0} onClick={() => { setIdx(idx - 1); setMeasure(undefined); }} aria-label="Previous hole">
          ‹
        </button>
        <div className="hole-info">
          <div className="hole-no">Hole {hole.number}</div>
          <div className="muted small">
            Par {hole.par} · SI {hole.si}
            {hole.lengthM ? ` · ${fmtDist(hole.lengthM, units)}${units}` : ''}
          </div>
        </div>
        <button className="icon-btn" disabled={isLast} onClick={() => { setIdx(idx + 1); setMeasure(undefined); }} aria-label="Next hole">
          ›
        </button>
      </div>
      )}
      <div className="headline">{live.field ? computeResult(live.field).headline : result.headline}</div>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'hole', label: 'Hole' }, { value: 'card', label: 'Scorecard' }]} />

      {tab === 'card' ? (
        <div className="content">
          {live.field && (
            <Segmented
              value={cardView}
              onChange={setCardView}
              options={[
                { value: 'field', label: `Everyone (${live.groups} groups)` },
                { value: 'group', label: 'Our group' },
              ]}
            />
          )}
          <Scorecard
            round={live.field && cardView === 'field' ? live.field : round}
            onHole={(n) => { setIdx(round.holes.findIndex((h) => h.number === n)); setTab('hole'); }}
          />
          {live.field && cardView === 'field' && <p className="muted small">The other groups' scores come straight from their scorers' phones as they enter them.</p>}
          {!round.liveCode && (
            <p className="muted small">
              Playing against another group or team? Tap <strong>Go live</strong> on the Hole page and send their scorer the link. Their scores then show here too.
            </p>
          )}
        </div>
      ) : (
        <div className="content">
          {hole.green && (
            <HoleView
              hole={{ ...hole, path: hole.path ?? course?.holes.find((h) => h.number === hole.number)?.path }}
              hazards={holeHazards}
              player={geo.pos ?? undefined}
              onHole={onHole}
              pin={pin}
              target={measure}
              onTarget={setMeasure}
              onPin={(p) => update((r) => withPin(r, hole.number, p))}
              pinMode={mapMode === 'pin'}
              onPinMode={(on) => setMapMode(on ? 'pin' : 'measure')}
              onClearPin={() => update((r) => withPin(r, hole.number, undefined))}
              ball={round.balls?.[hole.number]}
              marking={spotMark}
              onMarkHere={markHere}
              shots={shots}
              advice={advice}
              showCaddy={caddyOnMap}
              onPrev={idx > 0 ? () => { setIdx(idx - 1); setMeasure(undefined); } : undefined}
              onNext={!isLast ? () => { setIdx(idx + 1); setMeasure(undefined); } : undefined}
              onCaddyTap={() => document.getElementById('caddy-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              units={units}
              playsLike={extrasAllowed ? pl?.distance : undefined}
              wind={extrasAllowed && wx ? { kmh: wx.windKmh, fromDeg: wx.windFromDeg } : undefined}
              dem={rules.aids === 'full' ? dem : null}
              imagery={qldCourse && imageryPref === 'qld' ? QLD_AERIAL : ESRI}
              onSwitchImagery={qldCourse ? switchImagery : undefined}
              rulesNote={rules.aids !== 'full' ? `🏆 ${rules.comp?.name ?? 'Comp'} rules: ${AIDS_LABELS[rules.aids]}` : undefined}
              gpsWarning={geo.accuracy != null && geo.accuracy > 15 ? `GPS ±${Math.round(geo.accuracy)} m` : undefined}
            />
          )}
          <LiveControl round={round} hole={hole.number} go={go} onLive={(code, group) => update((r) => ({ ...r, liveCode: code, liveGroup: group }))} />
          {round.compIds?.length ? (
            <button className="banter-btn" onClick={() => go({ name: 'chat', compId: round.compIds![0] })}>
              <span className="banter-icon">💬</span>
              <span className="grow">
                <strong>Comp banter</strong>
                <span className="muted small banter-last">Birdies and blow-ups get posted by themselves 🐦💀</span>
              </span>
              <span>›</span>
            </button>
          ) : null}
          {advice && (
            <div id="caddy-card">
            <CaddyCard
              advice={advice}
              planning={!onHole}
              apiKey={settings.anthropicKey}
              showOnMap={caddyOnMap}
              onToggleMap={() => setCaddyOnMap((v) => !v)}
              units={units}
              context={() => ({
                course: round.courseName,
                hole: { number: hole.number, par: hole.par, strokeIndex: hole.si, lengthM: hole.lengthM },
                metresToPin: Math.round(advice!.toPin),
                playsLikeM: Math.round(advice!.playsLike),
                recommendation: { club: advice!.headline, aim: advice!.aimText, expectedStrokesToFinish: +advice!.best.ev.toFixed(2), troubleOdds: advice!.trouble },
                alternative: advice!.alt ? { club: advice!.alt.club.club, expectedStrokesToFinish: +advice!.alt.ev.toFixed(2), troubleOdds: advice!.alt.trouble } : undefined,
                reasons: advice!.lines,
                wind: wx ? { kmh: Math.round(wx.windKmh), gustKmh: Math.round(wx.gustKmh), fromDeg: Math.round(wx.windFromDeg), tempC: Math.round(wx.tempC) } : 'unknown',
                golfer: { handicap: caddyHcp, scoreSoFar: round.scores[round.meId] },
              })}
            />
            </div>
          )}
          {/* Map: no green mapped yet */}
          {!hole.green && (
            <Card className="map-card">
              <p className="muted">
                This green isn't mapped yet. Tap <strong>Map green</strong> below and tap the green on the satellite map (or stand on it), and it's saved for next time.
              </p>
              <HoleMap
                hole={hole}
                player={geo.pos ?? undefined}
                pin={pin}
                shots={shots}
                units={units}
                onTap={onMapTap}
                measure={measure}
                centre={course?.location}
                height={300}
                hazards={holeHazards}
              />
              {course && (
                <button className="btn small" onClick={() => go({ name: 'course', id: course.id })}>
                  Map green in course editor
                </button>
              )}
            </Card>
          )}
          {hole.green && far && <p className="muted small center">You're {(dist!.centre / 1000).toFixed(1)} km from this green, so the numbers are from the tee until you get there.</p>}
          {hole.green && !geo.pos && <p className="muted small center">{geo.error ?? 'Getting your GPS position…'}</p>}
          {!wx && wxErr && <p className="muted small center">Wind unavailable: {wxErr}</p>}

          {/* Shot tracking (if this round tracks shots) */}
          {round.trackShots === false ? (
            <button className="btn ghost small" onClick={() => update((r) => ({ ...r, trackShots: true }))}>
              📍 Track shots after all
            </button>
          ) : (
          <Card title="Shot tracker">
            <div className="row gap">
              <select value={club} onChange={(e) => setClub(e.target.value)}>
                {settings.clubs.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <button
                className="btn grow"
                disabled={!geo.pos}
                onClick={() => geo.pos && update((r) => ({ ...r, shots: { ...r.shots, [hole.number]: [...(r.shots[hole.number] ?? []), { ...geo.pos!, club, t: Date.now() }] } }))}
              >
                📍 Mark shot from here
              </button>
            </div>
            {lastShot && lastShotDist != null && (
              <p className="small">
                Last shot{lastShot.club ? ` (${lastShot.club})` : lastShot.voice ? ' (Siri)' : ''}: <strong>{fmtDist(lastShotDist, units)}{units}</strong> to where you're standing now
              </p>
            )}
            {shots.some((x) => x.voice) && (
              <div className="siri-shots">
                <span className="muted small">🎙️ Marked with Siri. Check or pick the club (for your club distances).</span>
                {shots.map((x, i) =>
                  x.voice ? (
                    <label key={x.t} className="row gap small">
                      <span>Shot {i + 1}</span>
                      <select
                        value={x.club ?? ''}
                        onChange={(e) =>
                          update((r) => ({ ...r, shots: { ...r.shots, [hole.number]: (r.shots[hole.number] ?? []).map((y) => (y.t === x.t ? { ...y, club: e.target.value || undefined } : y)) } }))
                        }
                      >
                        <option value="">Pick a club</option>
                        {settings.clubs.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                  ) : null,
                )}
              </div>
            )}
            {shots.length > 0 && (
              <button className="btn ghost small" onClick={() => update((r) => ({ ...r, shots: { ...r.shots, [hole.number]: shots.slice(0, -1) } }))}>
                Undo last shot
              </button>
            )}
            <p className="muted small">Mark each shot before you hit it. Your club distances build up in My stats, and the shots are traced on the map.</p>
            <button className="btn ghost small" onClick={() => go({ name: 'tracer' })}>
              🎥 Film a shot with a tracer
            </button>
            {Object.values(round.shots).some((x) => x.length) && (
              <button className="btn ghost small" onClick={() => setReplayOpen(true)}>
                📺 Replay my shots so far
              </button>
            )}
            {replayOpen && <RoundReplay round={round} units={units} startHole={hole.number} onClose={() => setReplayOpen(false)} />}
            <button className="btn ghost small" onClick={() => go({ name: 'siri' })}>
              🎙️ Mark shots hands-free: "Hey Siri, mark shot"
            </button>
            <button className="btn ghost small" onClick={() => update((r) => ({ ...r, trackShots: false }))}>
              Stop tracking shots this round
            </button>
          </Card>
          )}

          {/* Scores */}
          <Card title="Scores">
            {marking && (
              <p className="marking-note small">
                ✍️ <strong>Cross-marking</strong> with {marking.phones.filter((p) => p.group !== round.liveGroup).map((p) => p.name).join(' & ')}. You mark{' '}
                {sides.filter((x) => !lockedBy(x.id)).map((x) => x.name).join(', ') || 'nobody yet'}. Everyone else is marked on another phone and shows up here as they enter it, so nobody scores themselves.
              </p>
            )}
            {sides.map((s) => {
              const v = round.scores[s.id]?.[hole.number];
              const strokes = strokeMap[s.id]?.[hole.number] ?? 0;
              const by = lockedBy(s.id);
              return (
                <div key={s.id} className={`score-row ${by ? 'locked' : ''}`}>
                  <div>
                    <strong>{s.name}</strong>
                    <div className="muted small">
                      {round.format === 'ambrose' ? `Team hcp ${s.handicap}` : `Hcp ${s.handicap}`}
                      {strokes ? ` · ${strokes > 0 ? '+' : ''}${strokes} shot${Math.abs(strokes) > 1 ? 's' : ''} here` : ''}
                      {by ? ` · 🔒 marked by ${by}` : ''}
                    </div>
                  </div>
                  <div className="row gap">
                    <button className="icon-btn" disabled={!!by} onClick={() => setScore(s.id, v == null ? hole.par : Math.max(1, v - 1))} aria-label={`${s.name} minus`}>
                      −
                    </button>
                    <span className={`score-val ${scoreClass(v, hole.par)}`} onClick={() => v == null && setScore(s.id, hole.par)}>
                      {v ?? (by ? '…' : '–')}
                    </span>
                    <button className="icon-btn" disabled={!!by} onClick={() => setScore(s.id, v == null ? hole.par : Math.min(15, v + 1))} aria-label={`${s.name} plus`}>
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </Card>

          {/* My stats */}
          <Card title={round.format === 'ambrose' ? 'Team stats (for coaching)' : 'My stats (for coaching)'}>
            <div className="stat-grid">
              <Stepper label="Putts" value={stats.putts} max={6} onChange={(v) => setStats({ putts: v })} />
              <Stepper label="Penalties" value={stats.penalties ?? 0} max={6} onChange={(v) => setStats({ penalties: v })} />
              <Stepper label="Bunker shots" value={stats.sand ?? 0} max={6} onChange={(v) => setStats({ sand: v })} />
            </div>
            {hole.par >= 4 && (
              <div className="field">
                <span>Tee shot</span>
                <Segmented<FairwayResult>
                  value={stats.fairway}
                  onChange={(v) => setStats({ fairway: v })}
                  options={[
                    { value: 'left', label: '← Left' },
                    { value: 'hit', label: 'Fairway' },
                    { value: 'right', label: 'Right →' },
                  ]}
                />
              </div>
            )}
            {gir === false && (
              <div className="field">
                <span>Approach missed the green…</span>
                <Segmented
                  value={stats.approachMiss}
                  onChange={(v) => setStats({ approachMiss: v })}
                  options={[
                    { value: 'short', label: 'Short' },
                    { value: 'long', label: 'Long' },
                    { value: 'left', label: 'Left' },
                    { value: 'right', label: 'Right' },
                  ]}
                />
              </div>
            )}
            {gir != null && <p className="small">{gir ? '✅ Green in regulation' : '❌ Missed green in regulation'}</p>}
            <label className="field narrow">
              <span>First putt (m)</span>
              <input inputMode="decimal" value={stats.firstPuttM ?? ''} onChange={(e) => setStats({ firstPuttM: e.target.value ? Number(e.target.value) : undefined })} />
            </label>
            {round.format === 'ambrose' && (
              <div className="field">
                <span>Whose drive did you use?</span>
                <div className="row gap wrap">
                  {round.players
                    .filter((p) => round.teams?.find((t) => t.id === me)?.playerIds.includes(p.id))
                    .map((p) => (
                      <button key={p.id} className={`chip ${stats.drivePlayerId === p.id ? 'on' : ''}`} onClick={() => setStats({ drivePlayerId: p.id })}>
                        {p.name} ({drivesUsed(round, p.id)})
                      </button>
                    ))}
                </div>
              </div>
            )}
          </Card>

          <div className="row between">
            {idx > 0 ? (
              <button className="btn" onClick={() => { setIdx(idx - 1); setMeasure(undefined); }}>
                ‹ Hole {round.holes[idx - 1].number}
              </button>
            ) : (
              <span />
            )}
            {isLast ? (
              <button className="btn primary" onClick={finish}>
                Finish & coach me
              </button>
            ) : (
              <button className="btn primary" onClick={() => { setIdx(idx + 1); setMeasure(undefined); window.scrollTo(0, 0); }}>
                Hole {round.holes[idx + 1].number} ›
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function drivesUsed(round: Round, playerId: string) {
  return Object.values(round.stats).filter((s) => s.drivePlayerId === playerId).length;
}

function useMemoStrokes(round: Round | undefined) {
  return useMemo(() => {
    const out: Record<string, Record<number, number>> = {};
    if (!round || round.format === 'ambrose') return out;
    const sides = sidesFor(round);
    // Match play: strokes are given off the low marker.
    const low = round.format === 'matchplay' ? Math.min(...sides.map((s) => s.handicap)) : 0;
    for (const s of sides) out[s.id] = strokesByHole(s.handicap - low, round.holes);
    return out;
  }, [round]);
}
