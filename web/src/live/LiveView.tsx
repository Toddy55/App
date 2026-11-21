import { useEffect, useState } from 'react';
import type { Round } from '../types';
import { applyBundle, autoMap, decodeBundle, encodeBundle, type Bundle } from '../lib/share';
import { uid } from '../lib/storage';
import { newGroupId } from './payload';
import { mergeEventBundles } from '../lib/merge';
import { computeComp, valueLabel } from '../lib/comps';
import { computeResult, FORMAT_LABELS } from '../lib/scoring';
import { store } from '../lib/storage';
import { Scorecard } from '../components/Scorecard';
import { ShotCam } from '../components/ShotCam';
import { StandingsTable } from '../screens/Leaderboards';
import { Card, Header, type Go } from '../components/ui';
import type { GroupDoc } from './live';
import { liveAvailable } from './config';
import { learnCrews } from './liveFriends';

interface Group {
  id: string;
  doc: GroupDoc;
  bundle: Bundle;
}

/** Watch every group of a live event on one merged leaderboard. */
export function LiveView({ go, code }: { go: Go; code: string }) {
  const [groups, setGroups] = useState<Group[] | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!liveAvailable()) {
      setErr("Live scoring isn't set up in this copy of the app.");
      return;
    }
    let unsub: (() => void) | undefined;
    let cancelled = false;
    import('./live')
      .then(({ watchEvent }) =>
        watchEvent(
          code,
          async (docs) => {
            if (!docs) return setGroups(null);
            try {
              const decoded = await Promise.all(
                Object.entries(docs).map(async ([id, doc]) => ({ id, doc, bundle: await decodeBundle(doc.data) })),
              );
              decoded.sort((a, b) => (a.bundle.rounds[0]?.startedAt ?? 0) - (b.bundle.rounds[0]?.startedAt ?? 0));
              decoded.forEach((g) => learnCrews(g.bundle));
              setGroups(decoded);
              setFlash(true);
              setTimeout(() => setFlash(false), 900);
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            }
          },
          (e) => setErr(e.message),
        ),
      )
      .then((u) => {
        if (cancelled) u();
        else unsub = u;
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    const t = setInterval(() => tick((n) => n + 1), 10000);
    return () => {
      cancelled = true;
      unsub?.();
      clearInterval(t);
    };
  }, [code]);

  const bundle = groups?.length ? mergeEventBundles(groups.map((g) => g.bundle), code) : null;
  const round: Round | undefined = bundle?.rounds[0];
  const nameOf = (id: string) => bundle?.people.find((p) => p.key === id)?.name ?? id;
  const allFinal = !!groups?.length && groups.every((g) => g.doc.status === 'final');
  const latest = groups?.length ? Math.max(...groups.map((g) => g.doc.updatedAt)) : 0;
  const ago = latest ? Math.max(0, Math.round((Date.now() - latest) / 60000)) : 0;
  const myGroup = store.rounds().find((r) => r.liveCode === code && r.liveGroup);

  const joinAsScorer = () => {
    if (!round) return;
    // Make sure this phone has the course (with mapped greens) before setting up the round
    if (!store.courses().some((c) => c.id === round.courseId)) {
      store.saveCourse({ id: round.courseId, name: round.courseName, holes: round.holes, source: 'osm', updatedAt: Date.now() });
    }
    go({ name: 'setup', courseId: round.courseId, liveCode: code, format: round.format, holes: round.holes.map((h) => h.number), compIds: round.compIds });
  };

  // Second phone in the same group: copy that group's card and mark the other side(s)
  const joinAsMarker = (g: Group) => {
    const host = g.bundle.rounds[0];
    if (!host) return;
    const s = store.settings();
    const sub = { ...g.bundle, rounds: [host] };
    const plan = applyBundle(sub, autoMap(sub, s.me, store.friends()), uid);
    plan.newFriends.forEach((f) => store.saveFriend(f));
    for (const c of plan.comps) {
      const mine = store.comp(c.id);
      store.saveComp(mine ? { ...c, memberIds: [...new Set([...mine.memberIds, ...c.memberIds])] } : c);
    }
    const r = plan.rounds[0];
    if (!store.courses().some((c) => c.id === r.courseId)) {
      store.saveCourse({ id: r.courseId, name: r.courseName, holes: r.holes, source: 'osm', updatedAt: Date.now() });
    }
    const myTeam = r.teams?.find((t) => t.playerIds.includes('me'));
    const local: Round = {
      ...r,
      id: uid(),
      meId: myTeam ? myTeam.id : r.players.some((p) => p.id === 'me') ? 'me' : r.meId,
      stats: {},
      shots: {},
      pins: {},
      completed: false,
      sharedBy: undefined,
      liveCode: code,
      liveGroup: newGroupId(),
      liveSameAs: g.id,
      startedAt: Date.now(),
    };
    store.saveRound(local);
    go({ name: 'play', roundId: local.id });
  };

  const save = async () => {
    if (!bundle) return;
    go({ name: 'import', data: await encodeBundle(bundle) });
  };

  return (
    <div className="screen">
      <Header title="Live scores" onBack={() => go({ name: 'home' })} />
      <div className="content">
        {err && <p className="error">{err}</p>}
        {groups === undefined && !err && <p className="muted">Connecting…</p>}
        {groups === null && (
          <Card>
            <p>
              No live round with code <strong>{code}</strong> yet. Check the code with your scorer.
            </p>
          </Card>
        )}
        {groups && round && bundle && (
          <>
            <Card className={`live-head ${flash ? 'flash' : ''}`}>
              <div className="eyebrow">
                {allFinal ? (
                  '🏁 Final'
                ) : (
                  <>
                    <span className="live-dot synced" /> Live
                  </>
                )}{' '}
                · {round.courseName} · {FORMAT_LABELS[round.format]}
              </div>
              <h2 className="result">{computeResult(round).headline}</h2>
              <ul className="group-status">
                {groups.map((g) => (
                  <li key={g.id}>
                    <strong>{g.bundle.rounds[0]?.liveSameAs ? '↳ Marker' : `Group ${groups.filter((x) => !x.bundle.rounds[0]?.liveSameAs).indexOf(g) + 1}`}</strong> ({g.doc.scorer} {g.bundle.rounds[0]?.liveSameAs ? 'marking' : 'scoring'}): {g.doc.status === 'final' ? 'finished' : `on hole ${g.doc.hole}`}
                    <span className="muted small"> · {g.bundle.rounds[0]?.players.map((p) => p.name).join(', ')}</span>
                  </li>
                ))}
              </ul>
              <p className="muted small">Updated {ago < 1 ? 'just now' : `${ago} min ago`}</p>
            </Card>

            <ShotCam code={code} />

            <Card title={groups.length > 1 ? 'Whole field' : 'Scorecard'}>
              <Scorecard round={round} />
            </Card>

            {bundle.comps.map((c) => {
              // "If it finished now": score everyone over the holes the whole field has played
              const sideIds = round.format === 'ambrose' ? (round.teams ?? []).map((t) => t.id) : round.players.map((p) => p.id);
              const played = round.holes.filter((h) => sideIds.every((id) => round.scores[id]?.[h.number] != null)).map((h) => h.number);
              if (!allFinal && played.length === 0) return null;
              const projected: Round = { ...round, completed: true, scoreHoles: allFinal ? undefined : played };
              const res = computeComp(c, bundle.rounds.map((r) => (r.id === round.id ? projected : r)), nameOf);
              const leader = res.standings.find((s) => s.played);
              if (!leader) return null;
              return (
                <Card key={c.id} title={`🏆 ${c.name}${allFinal ? '' : `: if it finished now (thru ${played.length})`}`}>
                  <StandingsTable comp={c} standings={res.standings} />
                  <p className="muted small">
                    {leader.name} would lead on {valueLabel(c, leader)}.{groups.length > 1 ? ' All groups are ranked together.' : ''}
                  </p>
                </Card>
              );
            })}

            <button className="btn primary block" onClick={save}>
              {allFinal ? 'Add the full-field round to my app' : 'Save a copy so far'}
            </button>
            {!allFinal &&
              (myGroup ? (
                <button className="btn block" onClick={() => go({ name: 'play', roundId: myGroup.id })}>
                  Back to scoring my group
                </button>
              ) : (
                <>
                  {groups
                    .filter((g) => !g.bundle.rounds[0]?.liveSameAs)
                    .map((g) => (
                      <button key={g.id} className="btn block" onClick={() => joinAsMarker(g)}>
                        ✍️ I'm in {g.doc.scorer}'s group: I'll mark the other side
                      </button>
                    ))}
                  <button className="btn block" onClick={joinAsScorer}>
                    ✍️ We're a different group or team
                  </button>
                  <p className="muted small center">
                    Same group, two phones? Each phone marks the other side, never its own, so nobody scores themselves.
                  </p>
                </>
              ))}
            <p className="muted small center">The page updates by itself. Keep it open and watch the scores come in.</p>
          </>
        )}
      </div>
    </div>
  );
}

export function JoinLive({ go }: { go: Go }) {
  const [code, setCode] = useState('');
  if (!liveAvailable()) return null;
  return (
    <Card title="📡 Watch or join a live round">
      <form
        className="row gap"
        onSubmit={(e) => {
          e.preventDefault();
          const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (c.length >= 6) go({ name: 'live', code: c });
        }}
      >
        <input className="grow" placeholder="Code from your scorer" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" />
        <button className="btn">Open</button>
      </form>
    </Card>
  );
}
