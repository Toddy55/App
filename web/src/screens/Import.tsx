import { useEffect, useState } from 'react';
import { store, uid } from '../lib/storage';
import { applyBundle, autoMap, decodeBundle, type Bundle, type Mapping } from '../lib/share';
import { roundDay } from '../lib/comps';
import { FORMAT_LABELS } from '../lib/scoring';
import { Card, Header, type Go } from '../components/ui';

export function Import({ go, data }: { go: Go; data: string }) {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [skip, setSkip] = useState<Record<string, boolean>>({});
  const settings = store.settings();
  const friends = store.friends();
  const local = store.rounds();

  useEffect(() => {
    decodeBundle(data)
      .then((b) => {
        setBundle(b);
        setMapping(autoMap(b, settings.me, friends));
        // Skip rounds that look like ones we've already got (same course, same day, entered on this phone)
        const s: Record<string, boolean> = {};
        for (const r of b.rounds) {
          const dupe = local.find((l) => l.id !== r.id && l.courseName === r.courseName && roundDay(l) === roundDay(r) && !l.sharedBy);
          if (dupe) s[r.id] = true;
        }
        setSkip(s);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'That link looks broken or incomplete.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const doImport = () => {
    if (!bundle) return;
    const plan = applyBundle({ ...bundle, rounds: bundle.rounds.filter((r) => !skip[r.id]) }, mapping, uid);
    plan.newFriends.forEach((f) => store.saveFriend(f));
    for (const c of plan.comps) {
      const mine = store.comp(c.id);
      store.saveComp(mine ? { ...c, memberIds: [...new Set([...mine.memberIds, ...c.memberIds])] } : c);
    }
    for (const r of plan.rounds) {
      const mine = store.round(r.id);
      // Keep anything personal we already had for this round (our stats, shots, AI report)
      store.saveRound(
        mine
          ? { ...r, stats: mine.stats, shots: mine.shots, pins: mine.pins, aiReport: mine.aiReport, meId: mine.meId, sharedBy: mine.sharedBy, compIds: [...new Set([...(mine.compIds ?? []), ...(r.compIds ?? [])])] }
          : r,
      );
    }
    history.replaceState(null, '', location.pathname);
    if (plan.comps[0]) go({ name: 'comp', id: plan.comps[0].id });
    else if (plan.rounds[0]) go({ name: 'summary', roundId: plan.rounds[0].id });
    else go({ name: 'home' });
  };

  return (
    <div className="screen">
      <Header title="Import from a mate" onBack={() => go({ name: 'home' })} />
      <div className="content">
        {err && <p className="error">{err}</p>}
        {!bundle && !err && <p className="muted">Opening link…</p>}
        {bundle && (
          <>
            <Card>
              <p>
                <strong>{bundle.from}</strong> shared {bundle.rounds.length ? `${bundle.rounds.length} round${bundle.rounds.length > 1 ? 's' : ''}` : ''}
                {bundle.rounds.length && bundle.comps.length ? ' and ' : ''}
                {bundle.comps.length ? `the comp "${bundle.comps.map((c) => c.name).join('", "')}"` : ''}.
              </p>
            </Card>
            <Card title="Who's who?">
              <p className="muted small">Match each player to someone on your phone, so the leaderboards line up.</p>
              {bundle.people.map((p) => (
                <div key={p.key} className="row between">
                  <strong>{p.name}</strong>
                  <select value={mapping[p.key]} onChange={(e) => setMapping({ ...mapping, [p.key]: e.target.value })} style={{ maxWidth: '55%' }}>
                    <option value="me">That's me ({settings.me.name})</option>
                    {friends.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                    <option value="new">New friend: {p.name}</option>
                  </select>
                </div>
              ))}
              {!Object.values(mapping).includes('me') && (
                <p className="warn small">None of these players is set as you. That's fine if you weren't playing; otherwise pick "That's me".</p>
              )}
            </Card>
            {bundle.rounds.length > 0 && (
              <Card title="Rounds">
                <ul className="list">
                  {bundle.rounds.map((r) => (
                    <li key={r.id} className="row between">
                      <div>
                        <strong>{r.courseName}</strong>
                        <div className="muted small">
                          {new Date(r.date).toLocaleDateString('en-AU')} · {FORMAT_LABELS[r.format]} · {r.players.length} players
                          {store.round(r.id) ? ' · already on your phone (scores will update)' : ''}
                        </div>
                      </div>
                      <label className="check">
                        <input type="checkbox" checked={!skip[r.id]} onChange={(e) => setSkip({ ...skip, [r.id]: !e.target.checked })} /> Add
                      </label>
                    </li>
                  ))}
                </ul>
                {Object.values(skip).some(Boolean) && <p className="muted small">Unticked rounds look like ones you already scored yourself.</p>}
              </Card>
            )}
            <button className="btn primary block big" onClick={doImport}>
              Import
            </button>
          </>
        )}
      </div>
    </div>
  );
}
