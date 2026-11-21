import { useEffect, useState } from 'react';
import type { Round } from '../types';
import { decodeBundle, encodeBundle, type Bundle } from '../lib/share';
import { mergeEventBundles } from '../lib/merge';
import { computeComp, valueLabel } from '../lib/comps';
import { computeResult, FORMAT_LABELS } from '../lib/scoring';
import { store } from '../lib/storage';
import { Scorecard } from '../components/Scorecard';
import { StandingsTable } from '../screens/Leaderboards';
import { Card, Header, type Go } from '../components/ui';
import type { GroupDoc } from './live';
import { liveAvailable } from './config';

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
                {groups.map((g, i) => (
                  <li key={g.id}>
                    <strong>Group {i + 1}</strong> ({g.doc.scorer} scoring): {g.doc.status === 'final' ? 'finished' : `on hole ${g.doc.hole}`}
                    <span className="muted small"> · {g.bundle.rounds[0]?.players.map((p) => p.name).join(', ')}</span>
                  </li>
                ))}
              </ul>
              <p className="muted small">Updated {ago < 1 ? 'just now' : `${ago} min ago`}</p>
            </Card>

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
                <button className="btn block" onClick={joinAsScorer}>
                  ✍️ Join with my group or team
                </button>
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
