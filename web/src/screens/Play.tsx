import { useEffect, useMemo, useRef, useState } from 'react';
import type { FairwayResult, HoleStats, LatLon, Round } from '../types';
import { store } from '../lib/storage';
import { distanceM, fmtDist, greenDistances } from '../lib/geo';
import { compass, fetchElevations, fetchWeather, playsLike, windEffect } from '../lib/weather';
import { computeResult, sidesFor } from '../lib/scoring';
import { strokesByHole } from '../lib/handicap';
import { useGeolocation, useWakeLock } from '../hooks';
import { HoleMap } from '../components/HoleMap';
import { Scorecard } from '../components/Scorecard';
import { Card, Header, Segmented, Stepper, scoreClass, type Go } from '../components/ui';

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
  const course = useMemo(() => (round ? store.courses().find((c) => c.id === round.courseId) : undefined), [round?.courseId]);

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
  const setScore = (sideId: string, v: number | undefined) =>
    update((r) => {
      const s = { ...(r.scores[sideId] ?? {}) };
      if (v == null) delete s[hole.number];
      else s[hole.number] = v;
      return { ...r, scores: { ...r.scores, [sideId]: s } };
    });

  const dist = geo.pos && hole.green ? greenDistances(geo.pos, hole.green, pin) : undefined;
  const far = dist && dist.centre > 1200;
  const wx = round.weather;
  const effect = wx && dist ? windEffect(wx.windFromDeg, wx.windKmh, dist.bearing) : undefined;
  const elevDiff = elev && elev.hole === hole.number ? elev.diff : 0;
  const pl = dist ? playsLike(dist.pin, effect, elevDiff, wx?.tempC) : undefined;
  const shots = round.shots[hole.number] ?? [];
  const lastShot = shots[shots.length - 1];
  const lastShotDist = lastShot && geo.pos ? distanceM(lastShot, geo.pos) : undefined;
  const result = computeResult(round);
  const meScore = round.scores[me]?.[hole.number];
  const gir = stats.putts != null && meScore != null ? meScore - stats.putts <= hole.par - 2 : undefined;
  const isLast = idx === round.holes.length - 1;

  const onMapTap = (p: LatLon) => {
    if (mapMode === 'pin') {
      update((r) => ({ ...r, pins: { ...r.pins, [hole.number]: p } }));
      setMapMode('measure');
    } else setMeasure(p);
  };

  const finish = () => {
    const missing = round.holes.filter((h) => round.scores[me]?.[h.number] == null).map((h) => h.number);
    if (missing.length && !confirm(`No score yet for hole${missing.length > 1 ? 's' : ''} ${missing.join(', ')}. Finish anyway?`)) return;
    update((r) => ({ ...r, completed: true, finishedAt: Date.now() }));
    go({ name: 'summary', roundId: round.id });
  };

  return (
    <div className="screen play">
      <Header
        title={round.courseName}
        onBack={() => go({ name: 'home' })}
        right={
          <button className="btn small" onClick={finish}>
            Finish
          </button>
        }
      />
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
      <div className="headline">{result.headline}</div>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'hole', label: 'Hole' }, { value: 'card', label: 'Scorecard' }]} />

      {tab === 'card' ? (
        <div className="content">
          <Scorecard round={round} onHole={(n) => { setIdx(round.holes.findIndex((h) => h.number === n)); setTab('hole'); }} />
        </div>
      ) : (
        <div className="content">
          {/* Distances */}
          <Card className="yardage">
            {!hole.green ? (
              <p className="muted">
                This green isn't mapped yet. Tap <strong>Map green</strong> below and tap the green on the satellite map (or stand on it), and it's saved for next time.
              </p>
            ) : !geo.pos ? (
              <p className="muted">{geo.error ?? 'Getting your GPS position…'}</p>
            ) : far ? (
              <p className="muted">You're {(dist!.centre / 1000).toFixed(1)} km from this green. Distances will show when you're on the hole.</p>
            ) : (
              <>
                <div className="yd-row">
                  <div className="yd">
                    <span className="yd-label">Front</span>
                    <span className="yd-num">{fmtDist(dist!.front, units)}</span>
                  </div>
                  <div className="yd main">
                    <span className="yd-label">{dist!.pinIsSet ? 'Pin' : 'Centre'}</span>
                    <span className="yd-num">{fmtDist(dist!.pin, units)}</span>
                  </div>
                  <div className="yd">
                    <span className="yd-label">Back</span>
                    <span className="yd-num">{fmtDist(dist!.back, units)}</span>
                  </div>
                </div>
                {dist!.pinIsSet && <div className="muted small center">Centre {fmtDist(dist!.centre, units)}{units}</div>}
                {pl && (
                  <div className="plays-like">
                    Plays like <strong>{fmtDist(pl.distance, units)}{units}</strong>
                    <span className="muted small">
                      {' '}
                      (wind {signed(pl.windAdj, units)}, slope {signed(pl.elevAdj, units)}, temp {signed(pl.tempAdj, units)})
                    </span>
                    {Math.abs(pl.aimOffM) >= 2 && (
                      <div className="small">
                        Aim {fmtDist(Math.abs(pl.aimOffM), units)}{units} {pl.aimOffM > 0 ? 'right' : 'left'} of target
                      </div>
                    )}
                  </div>
                )}
                {geo.accuracy != null && geo.accuracy > 15 && <div className="warn small">GPS accuracy ±{Math.round(geo.accuracy)} m</div>}
              </>
            )}
          </Card>

          {/* Wind */}
          <Card className="wind">
            {wx ? (
              <div className="row between">
                <div className="wind-arrow" style={{ transform: `rotate(${(effect ? effect.relativeDeg : wx.windFromDeg) + 180}deg)` }} aria-hidden>
                  ↑
                </div>
                <div className="grow">
                  <strong>
                    {Math.round(wx.windKmh)} km/h from the {compass(wx.windFromDeg)}
                  </strong>
                  <div className="muted small">
                    Gusts {Math.round(wx.gustKmh)} km/h · {Math.round(wx.tempC)}°C
                    {effect ? ` · ${effect.label}` : ''}
                  </div>
                  <div className="muted small">{effect ? 'Arrow shows the wind relative to your shot (up = toward the target).' : 'Arrow shows the wind with north up.'}</div>
                </div>
              </div>
            ) : (
              <p className="muted small">{wxErr ? `Wind unavailable: ${wxErr}` : 'Loading wind…'}</p>
            )}
          </Card>

          {/* Map */}
          <Card className="map-card">
            <div className="row between">
              <Segmented
                value={mapMode}
                onChange={setMapMode}
                options={[
                  { value: 'measure', label: 'Tap to measure' },
                  { value: 'pin', label: pin ? 'Move pin' : 'Set pin' },
                ]}
              />
              {pin && (
                <button className="btn ghost small" onClick={() => update((r) => { const p = { ...r.pins }; delete p[hole.number]; return { ...r, pins: p }; })}>
                  Clear pin
                </button>
              )}
            </div>
            <HoleMap hole={hole} player={geo.pos} pin={pin} shots={shots} units={units} onTap={onMapTap} measure={measure} centre={hole.green?.centre ?? course?.location} height={300} />
            {!hole.green && course && (
              <button className="btn small" onClick={() => go({ name: 'course', id: course.id })}>
                Map green in course editor
              </button>
            )}
          </Card>

          {/* Shot tracking */}
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
                Last shot ({lastShot.club}): <strong>{fmtDist(lastShotDist, units)}{units}</strong> to where you're standing now
              </p>
            )}
            {shots.length > 0 && (
              <button className="btn ghost small" onClick={() => update((r) => ({ ...r, shots: { ...r.shots, [hole.number]: shots.slice(0, -1) } }))}>
                Undo last shot
              </button>
            )}
            <p className="muted small">Mark each shot before you hit it. Your club distances build up in My stats.</p>
          </Card>

          {/* Scores */}
          <Card title="Scores">
            {sides.map((s) => {
              const v = round.scores[s.id]?.[hole.number];
              const strokes = strokeMap[s.id]?.[hole.number] ?? 0;
              return (
                <div key={s.id} className="score-row">
                  <div>
                    <strong>{s.name}</strong>
                    <div className="muted small">
                      {round.format === 'ambrose' ? `Team hcp ${s.handicap}` : `Hcp ${s.handicap}`}
                      {strokes ? ` · ${strokes > 0 ? '+' : ''}${strokes} shot${Math.abs(strokes) > 1 ? 's' : ''} here` : ''}
                    </div>
                  </div>
                  <div className="row gap">
                    <button className="icon-btn" onClick={() => setScore(s.id, v == null ? hole.par : Math.max(1, v - 1))} aria-label={`${s.name} minus`}>
                      −
                    </button>
                    <span className={`score-val ${scoreClass(v, hole.par)}`} onClick={() => v == null && setScore(s.id, hole.par)}>
                      {v ?? '–'}
                    </span>
                    <button className="icon-btn" onClick={() => setScore(s.id, v == null ? hole.par : Math.min(15, v + 1))} aria-label={`${s.name} plus`}>
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

function signed(m: number, units: 'm' | 'yd') {
  const v = Math.round(units === 'yd' ? m * 1.0936 : m);
  return v === 0 ? '0' : v > 0 ? `+${v}` : `${v}`;
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
