import type { Competition, Round } from '../types';
import { store } from '../lib/storage';
import { makeBundle, type Bundle } from '../lib/share';
import { mergeEventBundles } from '../lib/merge';
import { computeComp, eligibleRounds, valueLabel } from '../lib/comps';
import { computeResult, parLabel, toParLabel, type LeaderRow } from '../lib/scoring';
import { useEventGroups } from '../live/useLiveField';
import { StandingsTable } from '../screens/Leaderboards';
import { Card, type Go } from './ui';

/**
 * A comp round being played right now: the live leaderboard and where the
 * comp table would stand if it finished now. Shown on the comp page.
 * `local` is this phone's own in-progress round (if it's the scorer).
 */
export function CompLive({ comp, code, local, course, scorer, go }: { comp: Competition; code?: string; local?: Round; course?: string; scorer?: string; go: Go }) {
  const groups = useEventGroups(code);
  const bundles: Bundle[] = [];
  if (local) {
    const s = store.settings();
    const history = eligibleRounds(comp, store.rounds()).filter((r) => r.id !== local.id && r.completed);
    bundles.push(makeBundle({ me: s.me, friends: store.friends(), rounds: [local, ...history], comps: [comp] }));
  }
  for (const g of groups) if (g.bundle.rounds[0] && (!local || g.id !== local.liveGroup)) bundles.push(g.bundle);

  if (!bundles.length) {
    return (
      <Card className="comp-live">
        <div className="eyebrow">
          <span className="live-dot synced" /> Live now{course ? ` · ${course}` : ''}
        </div>
        <p className="muted small">Connecting to {scorer ? `${scorer}'s` : 'the'} scorecard…</p>
      </Card>
    );
  }
  let b: Bundle;
  try {
    b = code ? mergeEventBundles(bundles, code) : bundles[0];
  } catch {
    return null;
  }
  const round = b.rounds[0];
  const result = computeResult(round);
  const nameOf = (k: string) => b.people.find((p) => p.key === k)?.name ?? store.nameOf(k);

  // "If it finished now": everyone over the holes the whole field has played
  const sideIds = round.format === 'ambrose' ? (round.teams ?? []).map((t) => t.id) : round.players.map((p) => p.id);
  const played = round.holes.filter((h) => sideIds.every((id) => round.scores[id]?.[h.number] != null)).map((h) => h.number);
  const bComp = b.comps.find((c) => c.id === comp.id) ?? comp;
  const projected: Round = { ...round, completed: true, scoreHoles: played };
  const res = played.length ? computeComp(bComp, b.rounds.map((r) => (r.id === round.id ? projected : r)), nameOf) : null;
  const leader = res?.standings.find((s) => s.played);

  return (
    <Card className="comp-live">
      <div className="row between">
        <div className="eyebrow">
          <span className="live-dot synced" /> Live now · {round.courseName}
        </div>
        {code && (
          <button className="btn small ghost" onClick={() => go({ name: 'live', code })}>
            Full card
          </button>
        )}
      </div>
      <h3 className="comp-live-head">{result.headline}</h3>
      <table className="live-board">
        <thead>
          <tr>
            <th />
            <th>{round.format === 'ambrose' ? 'Team' : 'Player'}</th>
            <th>Thru</th>
            <th>{scoreHeading(round)}</th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r, i) => (
            <tr key={r.id}>
              <td className="pos">{r.thru ? i + 1 : ''}</td>
              <td>{r.name}</td>
              <td>{r.thru || '–'}</td>
              <td className="val">{r.thru ? scoreText(round, r) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {res && leader && (
        <>
          <div className="eyebrow" style={{ marginTop: 12 }}>
            🏆 Comp table if it finished now (thru {played.length})
          </div>
          <StandingsTable comp={bComp} standings={res.standings} />
          <p className="muted small">
            {leader.name} would lead on {valueLabel(bComp, leader)}.
          </p>
        </>
      )}
    </Card>
  );
}

function scoreHeading(round: Round) {
  switch (round.format) {
    case 'stableford':
    case 'fourball':
      return 'Pts';
    case 'par':
    case 'matchplay':
      return 'v par';
    case 'skins':
      return 'Skins';
    default:
      return 'Net';
  }
}

function scoreText(round: Round, r: LeaderRow) {
  switch (round.format) {
    case 'stableford':
    case 'fourball':
      return String(r.points);
    case 'par':
    case 'matchplay':
      return parLabel(r.parScore);
    case 'skins':
      return String(r.skins);
    default:
      return toParLabel(Math.round(r.netToPar * 10) / 10);
  }
}
