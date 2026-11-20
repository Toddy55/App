import { useEffect, useState } from 'react';
import type { Round } from '../types';
import { decodeBundle, type Bundle } from '../lib/share';
import { computeComp, valueLabel } from '../lib/comps';
import { computeResult, FORMAT_LABELS } from '../lib/scoring';
import { Scorecard } from '../components/Scorecard';
import { StandingsTable } from '../screens/Leaderboards';
import { Card, Header, type Go } from '../components/ui';
import type { LiveDoc } from './live';
import { liveAvailable } from './config';

/** Watch a round live while the scorer enters the scores. */
export function LiveView({ go, code }: { go: Go; code: string }) {
  const [doc, setDoc] = useState<LiveDoc | null | undefined>(undefined);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!liveAvailable()) {
      setErr('Live scoring isn\'t set up in this copy of the app.');
      return;
    }
    let unsub: (() => void) | undefined;
    let cancelled = false;
    import('./live')
      .then(({ watchLive }) =>
        watchLive(
          code,
          async (d) => {
            setDoc(d);
            if (d) {
              try {
                setBundle(await decodeBundle(d.data));
                setFlash(true);
                setTimeout(() => setFlash(false), 900);
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e));
              }
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

  const round: Round | undefined = bundle?.rounds[0];
  const nameOf = (id: string) => bundle?.people.find((p) => p.key === id)?.name ?? id;
  const ago = doc ? Math.max(0, Math.round((Date.now() - doc.updatedAt) / 60000)) : 0;

  return (
    <div className="screen">
      <Header title="Live scores" onBack={() => go({ name: 'home' })} />
      <div className="content">
        {err && <p className="error">{err}</p>}
        {doc === undefined && !err && <p className="muted">Connecting…</p>}
        {doc === null && <Card><p>No live round with code <strong>{code}</strong>. Check the code with your scorer.</p></Card>}
        {doc && round && (
          <>
            <Card className={`live-head ${flash ? 'flash' : ''}`}>
              <div className="eyebrow">
                {doc.status === 'final' ? '🏁 Final' : (<><span className="live-dot synced" /> Live</>)} · {round.courseName} · {FORMAT_LABELS[round.format]}
              </div>
              <h2 className="result">{computeResult(round).headline}</h2>
              <p className="muted small">
                {doc.status === 'final' ? 'Round finished' : `Scorer ${doc.scorer} is on hole ${doc.hole}`} · updated {ago < 1 ? 'just now' : `${ago} min ago`}
              </p>
            </Card>
            <Card title="Scorecard">
              <Scorecard round={round} />
            </Card>
            {bundle!.comps.map((c) => {
              // "If it finished now": score the live round over the holes everyone has played so far
              const sideIds = round.format === 'ambrose' ? (round.teams ?? []).map((t) => t.id) : round.players.map((p) => p.id);
              const played = round.holes.filter((h) => sideIds.every((id) => round.scores[id]?.[h.number] != null)).map((h) => h.number);
              if (doc.status !== 'final' && played.length === 0) return null;
              const projected: Round = { ...round, completed: true, scoreHoles: doc.status === 'final' ? undefined : played };
              const rounds = bundle!.rounds.map((r) => (r.id === round.id ? projected : r));
              const res = computeComp(c, rounds, nameOf);
              const leader = res.standings.find((s) => s.played);
              if (!leader) return null;
              return (
                <Card key={c.id} title={`🏆 ${c.name}${doc.status === 'final' ? '' : `: if it finished now (thru ${played.length})`}`}>
                  <StandingsTable comp={c} standings={res.standings} />
                  {leader && <p className="muted small">{leader.name} would lead on {valueLabel(c, leader)}.</p>}
                </Card>
              );
            })}
            <button className="btn primary block" onClick={() => go({ name: 'import', data: doc.data })}>
              {doc.status === 'final' ? 'Add this round to my app' : 'Save a copy so far'}
            </button>
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
    <Card title="📡 Watch a live round">
      <form
        className="row gap"
        onSubmit={(e) => {
          e.preventDefault();
          const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (c.length >= 6) go({ name: 'live', code: c });
        }}
      >
        <input className="grow" placeholder="Code from your scorer" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" />
        <button className="btn">Watch</button>
      </form>
    </Card>
  );
}
