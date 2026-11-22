import { useEffect, useState } from 'react';
import { parseHcp } from '../components/HandicapEditor';
import type { Format, Round, RoundPlayer, Team } from '../types';
import { store, uid } from '../lib/storage';
import { ambroseTeamHandicap, dailyHandicap, DEFAULT_ALLOWANCE, playingHandicap } from '../lib/handicap';
import { FORMAT_BLURB, FORMAT_LABELS } from '../lib/scoring';
import { GameInfo } from '../components/GameInfo';
import { holesFromTee, teesFor, totalLength } from '../lib/tees';
import { fmtDist } from '../lib/geo';
import { aidsFor, AIDS_BLURB, AIDS_LABELS, suggestedComps } from '../lib/comps';
import { newGroupId } from '../live/payload';
import { Card, Header, Segmented, type Go } from '../components/ui';

interface P {
  id: string;
  name: string;
  ga: number;
}

const FORMATS: Format[] = ['stableford', 'stroke', 'par', 'ambrose', 'fourball', 'matchplay', 'skins'];

const WITH_KEY = 'gtg.setupWith';
/** Line up mates (and a format) for the next round setup, e.g. from the Friends list. Survives a trip to pick a course. */
export function planRoundWith(ids: string[], format?: Format) {
  try {
    sessionStorage.setItem(WITH_KEY, JSON.stringify({ ids, format, at: Date.now() }));
  } catch {
    /* private mode */
  }
}
function readPlan(): { ids: string[]; format?: Format } | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(WITH_KEY) || 'null');
    return v && Array.isArray(v.ids) && Date.now() - (v.at ?? 0) < 3600_000 ? v : null;
  } catch {
    return null;
  }
}

export function Setup({ go, courseId, join }: { go: Go; courseId?: string; join?: { code: string; format?: Format; holes?: number[]; compIds?: string[] } }) {
  const settings = store.settings();
  const [rev, setRev] = useState(0);
  const courses = store.courses();
  void rev;
  const [cid, setCid] = useState(courseId ?? courses[0]?.id);
  const course = courses.find((c) => c.id === cid);
  // Corrected pars and stroke indexes from the built-in list before you tee off
  useEffect(() => {
    const c = store.courses().find((x) => x.id === cid);
    if (!c?.osmRef) return;
    let stop = false;
    import('../lib/courseCatalog')
      .then(({ refreshCourse }) => refreshCourse(c))
      .then((fresh) => {
        if (stop || !fresh) return;
        store.saveCourse(fresh);
        setRev((n) => n + 1);
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [cid]);
  const [plan] = useState(() => (join ? null : readPlan()));
  const [format, setFormat] = useState<Format>(join?.format ?? plan?.format ?? 'stableford');
  const [which, setWhich] = useState<'18' | 'front' | 'back'>(() =>
    !join?.holes || join.holes.length > 9 ? '18' : join.holes[0] === 1 ? 'front' : 'back',
  );
  const [players, setPlayers] = useState<P[]>(() => [
    { id: 'me', name: settings.me.name, ga: settings.me.gaHandicap },
    ...(plan?.ids ?? []).flatMap((id) => {
      const f = store.friends().find((x) => x.id === id);
      return f ? [{ id: f.id, name: f.name, ga: f.gaHandicap }] : [];
    }),
  ]);
  const [allowance, setAllowance] = useState<number>(DEFAULT_ALLOWANCE[join?.format ?? plan?.format ?? 'stableford']);
  const [ambroseSize, setAmbroseSize] = useState<2 | 3 | 4>(4);
  const [skinsNet, setSkinsNet] = useState(false);
  const [carry, setCarry] = useState(true);
  // Tee box: remembered per course
  const [teePick, setTeePick] = useState<string | null>(null);
  // Men's or women's tees (when the club lists both): remembered
  const [womenTees, setWomenTees] = useState(() => {
    try {
      return localStorage.getItem('gtg.teeWomen') === '1';
    } catch {
      return false;
    }
  });
  const showWomen = (on: boolean) => {
    setWomenTees(on);
    setTeePick(null);
    try {
      localStorage.setItem('gtg.teeWomen', on ? '1' : '0');
    } catch {
      /* fine */
    }
  };
  const pickTee = (id: string) => {
    setTeePick(id);
    try {
      if (cid) localStorage.setItem(`gtg.tee.${cid}`, id);
    } catch {
      /* fine */
    }
  };
  // Remembered between rounds: some like to track every shot, some just want the scores
  const [trackShots, setTrackShots] = useState(() => {
    try {
      return localStorage.getItem('gtg.trackShots') !== '0';
    } catch {
      return true;
    }
  });
  const setTrack = (on: boolean) => {
    setTrackShots(on);
    try {
      localStorage.setItem('gtg.trackShots', on ? '1' : '0');
    } catch {
      /* fine */
    }
  };
  const [newName, setNewName] = useState('');
  const [newGa, setNewGa] = useState('');
  const friends = store.friends();
  const comps = store.comps();
  // null = follow the suggestion; otherwise the user's explicit picks
  const [compPick, setCompPick] = useState<string[] | null>(join?.compIds ?? null);
  const compIds = compPick ?? suggestedComps(comps, players.map((p) => p.id));
  const activeComps = comps.filter((c) => !c.end || c.end >= new Date().toISOString().slice(0, 10));

  const pickFormat = (f: Format) => {
    setFormat(f);
    setAllowance(DEFAULT_ALLOWANCE[f]);
  };

  if (!course) {
    return (
      <div className="screen">
        <Header title="New round" onBack={() => go({ name: 'home' })} />
        <div className="content">
          <Card>
            <p>First up, find your course.</p>
            <button className="btn primary" onClick={() => go({ name: 'courses', pick: true })}>
              Find a course
            </button>
          </Card>
        </div>
      </div>
    );
  }

  const holes =
    course.holes.length <= 9 || which === '18'
      ? course.holes
      : which === 'front'
        ? course.holes.filter((h) => h.number <= 9)
        : course.holes.filter((h) => h.number > 9);
  const tees = teesFor(course);
  const savedTee = (() => {
    try {
      return localStorage.getItem(`gtg.tee.${course.id}`);
    } catch {
      return null;
    }
  })();
  const bothKinds = tees.some((t) => t.women) && tees.some((t) => !t.women);
  const shown = bothKinds ? tees.filter((t) => !!t.women === womenTees) : tees;
  const tee = shown.find((t) => t.id === (teePick ?? savedTee)) ?? shown[0];
  // The holes as you'll play them: tee spot moved and lengths adjusted for your tee
  const played = holesFromTee(holes, tee);
  const slope = tee.slopeRating ?? course.slopeRating;
  const scratch = tee.scratchRating ?? course.scratchRating;
  const par18 = course.holes.reduce((s, h) => s + h.par, 0) * (course.holes.length <= 9 ? 2 : 1);
  const nine = holes.length <= 9;

  const addPlayer = (p: P) => {
    if (players.some((x) => x.id === p.id)) return;
    setPlayers([...players, p]);
  };

  const maxPlayers = format === 'ambrose' ? 8 : format === 'matchplay' || format === 'fourball' ? 4 : 6;
  const teamsNeeded = format === 'ambrose' || format === 'fourball' || (format === 'matchplay' && players.length === 4);
  const teamSize = format === 'ambrose' ? ambroseSize : 2;

  const problems: string[] = [];
  if (format === 'matchplay' && players.length !== 2 && players.length !== 4) problems.push('Match play needs 2 players (singles) or 4 (two pairs).');
  if (format === 'fourball' && players.length !== 4 && players.length !== 2) problems.push('4BBB needs 2 or 4 players.');
  if (format === 'ambrose' && players.length % ambroseSize !== 0) problems.push(`${ambroseSize}-person Ambrose needs players in groups of ${ambroseSize}. You have ${players.length}.`);
  if (format === 'skins' && players.length < 2) problems.push('Skins needs at least 2 players.');

  const start = () => {
    const rp: RoundPlayer[] = players.map((p) => {
      const dh = dailyHandicap(p.ga, par18, slope, scratch, holes.length);
      return { id: p.id, name: p.name, gaHandicap: p.ga, dailyHandicap: dh, playingHandicap: playingHandicap(dh, allowance) };
    });
    let teams: Team[] | undefined;
    if (teamsNeeded) {
      teams = [];
      for (let i = 0; i < rp.length; i += teamSize) {
        const members = rp.slice(i, i + teamSize);
        const t: Team = {
          id: `t${teams.length + 1}`,
          name: members.map((m) => m.name.split(' ')[0]).join(' & '),
          playerIds: members.map((m) => m.id),
          handicap: format === 'ambrose' ? ambroseTeamHandicap(members.map((m) => m.dailyHandicap)) : 0,
        };
        members.forEach((m) => (m.teamId = t.id));
        teams.push(t);
      }
    }
    const meId = format === 'ambrose' ? (teams?.find((t) => t.playerIds.includes('me'))?.id ?? teams?.[0]?.id ?? 'me') : 'me';
    const round: Round = {
      id: uid(),
      courseId: course.id,
      courseName: course.name,
      date: new Date().toISOString(),
      format,
      holes: played,
      teeName: tee.name,
      players: rp,
      teams,
      meId,
      scores: {},
      stats: {},
      shots: {},
      pins: {},
      trackShots,
      options: { allowance, skinsNet, skinsCarryOver: carry, ambroseSize: format === 'ambrose' ? ambroseSize : undefined },
      completed: false,
      compIds,
      liveCode: join?.code,
      liveGroup: join ? newGroupId() : undefined,
      startedAt: Date.now(),
    };
    store.saveRound(round);
    try {
      sessionStorage.removeItem(WITH_KEY);
    } catch {
      /* fine */
    }
    // remember playing partners for next time
    const known = store.friends();
    for (const p of players) if (p.id !== 'me' && !known.some((k) => k.id === p.id)) known.push({ id: p.id, name: p.name, gaHandicap: p.ga });
    store.saveFriends(known);
    go({ name: 'play', roundId: round.id });
  };

  return (
    <div className="screen">
      <Header title="New round" onBack={() => go({ name: 'home' })} />
      <div className="content">
        <Card title="Course">
          <div className="row between">
            <div>
              <strong>{course.name}</strong>
              <div className="muted small">
                Par {holes.reduce((s, h) => s + h.par, 0)}
                {slope ? ` · slope ${slope}` : ''}
                {scratch ? ` · scratch ${scratch}` : ' · no ratings set (Daily Handicap = GA Handicap)'}
              </div>
            </div>
            <button className="btn small" onClick={() => go({ name: 'courses', pick: true })}>
              Change
            </button>
          </div>
          {!course.cardEdited && holes.some((h) => h.parEst || h.siEst) && (
            <p className="warn small">
              ⚠️ The map data for {course.name} is missing {holes.some((h) => h.parEst) ? 'some pars (worked out from hole lengths)' : ''}
              {holes.some((h) => h.parEst) && holes.some((h) => h.siEst) ? ' and ' : ''}
              {holes.some((h) => h.siEst) ? 'the stroke indexes' : ''}. Check them against the club scorecard so points and shots are right.{' '}
              <button className="link" onClick={() => go({ name: 'course', id: course.id })}>
                Check the scorecard
              </button>
            </p>
          )}
          {courses.length > 1 && (
            <select value={cid} onChange={(e) => setCid(e.target.value)}>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {course.holes.length > 9 && !join && (
            <Segmented
              value={which}
              onChange={setWhich}
              options={[
                { value: '18', label: '18 holes' },
                { value: 'front', label: 'Front 9' },
                { value: 'back', label: 'Back 9' },
              ]}
            />
          )}
        </Card>

        {join && (
          <Card className="live-card on">
            <strong>✍️ Scoring another group · live code {join.code}</strong>
            <p className="muted small">
              Add the players in your group and tee off. Your card joins the same live leaderboard as the other groups. Format and holes match the first group.
            </p>
          </Card>
        )}
        <Card title="Tee box">
          {bothKinds && (
            <Segmented
              value={womenTees ? 'w' : 'm'}
              onChange={(v) => showWomen(v === 'w')}
              options={[
                { value: 'm', label: "Men's tees" },
                { value: 'w', label: "Women's tees" },
              ]}
            />
          )}
          <div className="tee-chips">
            {shown.map((t) => (
              <button key={t.id} className={`chip tee-chip ${t.id === tee.id ? 'on' : ''}`} onClick={() => pickTee(t.id)}>
                <i style={{ background: t.colour ?? '#94a3b8' }} />
                {bothKinds ? t.name.replace(" (women)", "") : t.name}
                <small>
                  {fmtDist(totalLength(holes, t), settings.units)}
                  {settings.units}
                </small>
              </button>
            ))}
          </div>
          <p className="muted small">
            {tee.estimated
              ? `${tee.name} tee lengths are estimated from the mapped tee until the club's tees are added (Courses → this course → Tees).`
              : `${tee.club ? "Club scorecard: hole lengths" : 'Hole lengths'}${tee.pars ? ' and pars' : ''} off the ${tee.name}${/tee/i.test(tee.name) ? '' : ' tees'}${tee.women ? " (women's ratings)" : ''}${tee.slopeRating ? `, slope ${tee.slopeRating}${tee.scratchRating ? ` / scratch ${tee.scratchRating}` : ''}` : ''}.`}{' '}
            Distances, the hole view and the caddie all play from here.
          </p>
        </Card>
        <Card title="Shot tracking">
          <label className="check">
            <input type="checkbox" checked={trackShots} onChange={(e) => setTrack(e.target.checked)} />
            <span>
              <strong>Mark my shots this round</strong>
              <span className="muted small"> Tap "Mark shot from here" (or say "Hey Siri, mark shot") before each shot for club distances, the replay and better caddie advice. Untick to just keep score.</span>
            </span>
          </label>
        </Card>
        <Card title="Format">
          {!join && <div className="format-grid">
            {FORMATS.map((f) => (
              <div key={f} className="format-wrap">
                <button className={`format ${format === f ? 'on' : ''}`} onClick={() => pickFormat(f)}>
                  {FORMAT_LABELS[f]}
                </button>
                <GameInfo id={f} />
              </div>
            ))}
          </div>}
          {join && <strong>{FORMAT_LABELS[format]}</strong>}
          <p className="muted small">{FORMAT_BLURB[format]}</p>
          {format === 'ambrose' && (
            <Segmented
              value={String(ambroseSize) as '2' | '3' | '4'}
              onChange={(v) => setAmbroseSize(Number(v) as 2 | 3 | 4)}
              options={[
                { value: '2', label: '2-person' },
                { value: '3', label: '3-person' },
                { value: '4', label: '4-person' },
              ]}
            />
          )}
          {format === 'skins' && (
            <div className="row gap wrap">
              <label className="check">
                <input type="checkbox" checked={skinsNet} onChange={(e) => setSkinsNet(e.target.checked)} /> Net skins
              </label>
              <label className="check">
                <input type="checkbox" checked={carry} onChange={(e) => setCarry(e.target.checked)} /> Ties carry over
              </label>
            </div>
          )}
          {format !== 'ambrose' && (
            <label className="field narrow">
              <span>Handicap allowance %</span>
              <input inputMode="numeric" value={allowance} onChange={(e) => setAllowance(Number(e.target.value) || 0)} />
            </label>
          )}
        </Card>

        <Card title={`Players (${players.length}/${maxPlayers})`}>
          {teamsNeeded && <p className="muted small">Teams are made in order: {teamSize === 2 ? 'players 1 & 2 v 3 & 4' : `groups of ${teamSize}`}.</p>}
          <ul className="list">
            {players.map((p, i) => {
              const dh = dailyHandicap(p.ga, par18, slope, scratch, holes.length);
              return (
                <li key={p.id} className="row between">
                  <div>
                    {teamsNeeded && <span className="team-tag">T{Math.floor(i / teamSize) + 1}</span>}
                    <strong>{p.name}</strong>
                    <div className="muted small">
                      GA {p.ga} → Daily {dh}
                      {nine ? ' (9 holes)' : ''}
                      {format !== 'ambrose' && allowance !== 100 ? ` → Playing ${playingHandicap(dh, allowance)}` : ''}
                    </div>
                  </div>
                  <div className="row gap">
                    {i > 0 && (
                      <button
                        className="icon-btn small"
                        aria-label="Move up"
                        onClick={() => {
                          const n = [...players];
                          [n[i - 1], n[i]] = [n[i], n[i - 1]];
                          setPlayers(n);
                        }}
                      >
                        ↑
                      </button>
                    )}
                    {p.id !== 'me' && (
                      <button className="icon-btn small" aria-label="Remove" onClick={() => setPlayers(players.filter((x) => x.id !== p.id))}>
                        ✕
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {(() => {
            // GA Handicaps change after every round: flag anyone not checked this week
            const all = [settings.me, ...store.friends()];
            const stale = players
              .map((p) => all.find((f) => f.id === p.id))
              .filter((f): f is NonNullable<typeof f> => !!f && f.hcpSource !== 'manual' && !!f.gaNumber && (!f.hcpCheckedAt || Date.now() - f.hcpCheckedAt > 7 * 24 * 3600 * 1000));
            return stale.length ? (
              <p className="warn small">
                ⏰ {stale.map((f) => f.name).join(', ')}: GA Handicap not checked this week. Tap {stale.length > 1 ? 'each name' : 'the name'} under Friends (or yours in Settings) and use "Check it on Golf Australia".
              </p>
            ) : null;
          })()}
          {format === 'ambrose' && players.length >= ambroseSize && (
            <p className="muted small">
              Team handicaps:{' '}
              {Array.from({ length: Math.ceil(players.length / ambroseSize) }, (_, t) => {
                const members = players.slice(t * ambroseSize, (t + 1) * ambroseSize);
                return `T${t + 1} ${ambroseTeamHandicap(members.map((m) => dailyHandicap(m.ga, par18, slope, scratch, holes.length)))}`;
              }).join(' · ')}
            </p>
          )}
          {players.length < maxPlayers && (
            <>
              <form
                className="row gap"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newName.trim()) return;
                  addPlayer({ id: uid(), name: newName.trim(), ga: parseHcp(newGa) ?? 0 });
                  setNewName('');
                  setNewGa('');
                }}
              >
                <input className="grow" placeholder="Player name" value={newName} onChange={(e) => setNewName(e.target.value)} />
                <input className="narrow-input" inputMode="decimal" placeholder="GA" value={newGa} onChange={(e) => setNewGa(e.target.value)} />
                <button className="btn">Add</button>
              </form>
              {friends.filter((f) => !players.some((p) => p.id === f.id)).length > 0 && (
                <div className="row gap wrap">
                  {friends
                    .filter((f) => !players.some((p) => p.id === f.id))
                    .map((f) => (
                      <button key={f.id} className="chip" onClick={() => addPlayer({ id: f.id, name: f.name, ga: f.gaHandicap })}>
                        + {f.name} ({f.hcpSource === 'manual' ? `${f.gaHandicap} manual` : f.gaHandicap})
                      </button>
                    ))}
                </div>
              )}
            </>
          )}
        </Card>

        {activeComps.length > 0 && (
          <Card title="Counts towards">
            <div className="row gap wrap">
              {activeComps.map((c) => {
                const on = compIds.includes(c.id);
                return (
                  <button key={c.id} className={`chip ${on ? 'on' : ''}`} onClick={() => setCompPick(on ? compIds.filter((x) => x !== c.id) : [...compIds, c.id])}>
                    {on ? '🏆 ' : ''}
                    {c.name}
                  </button>
                );
              })}
            </div>
            <p className="muted small">Only comp members' scores count. You can change this after the round too.</p>
            {(() => {
              const r = aidsFor(compIds, store.comps());
              return r.aids !== 'full' ? (
                <p className="small rules-note">
                  🏆 {r.comp?.name} rules: <strong>{AIDS_LABELS[r.aids]}</strong>. {AIDS_BLURB[r.aids]}
                </p>
              ) : null;
            })()}
          </Card>
        )}

        {problems.map((p) => (
          <p key={p} className="error">
            {p}
          </p>
        ))}
        <button className="btn primary block big" disabled={problems.length > 0} onClick={start}>
          Tee off
        </button>
      </div>
    </div>
  );
}
