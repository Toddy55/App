import { useEffect, useState } from 'react';
import type { Player } from '../types';
import { store, uid } from '../lib/storage';
import { headToHead } from '../lib/comps';
import { computeResult, FORMAT_LABELS } from '../lib/scoring';
import { Card, Header, type Go } from '../components/ui';
import { InviteSheet } from '../components/InviteSheet';
import { encodeBundle, friendUrl, makeBundle, personKey } from '../lib/share';
import { PasteInvite } from '../components/PasteInvite';
import { LiveFriendsCard } from '../components/LiveFriendsCard';
import { HandicapEditor, handicapLabel, STALE_MS } from '../components/HandicapEditor';

export function Friends({ go }: { go: Go }) {
  const [friends, setFriends] = useState<Player[]>(store.friends());
  const [name, setName] = useState('');
  const [ga, setGa] = useState('');
  const [inviting, setInviting] = useState<string | null>(null);
  // Mates who link up are added app-wide (MateWatcher); refresh the list when they are
  useEffect(() => {
    const on = () => setFriends(store.friends());
    window.addEventListener('gtg:friends', on);
    return () => window.removeEventListener('gtg:friends', on);
  }, []);
  const startInvite = async () => {
    const { myCrewCode } = await import('../live/crewChannel');
    const s = store.settings();
    // Just you: your name and handicap, plus your crew code so you hear when they link up
    const b = {
      ...makeBundle({ me: s.me, friends: [], rounds: [], comps: [] }),
      people: [{ key: personKey(s.me.name), name: s.me.name, ga: s.me.gaHandicap, ...(s.me.gaNumber ? { gaNo: s.me.gaNumber } : {}), ...(s.me.hcpSource ? { src: s.me.hcpSource } : {}) }],
      crew: myCrewCode(),
    };
    setInviting(friendUrl(await encodeBundle(b)));
  };
  const rounds = store.rounds();

  const add = () => {
    if (!name.trim()) return;
    store.saveFriend({ id: uid(), name: name.trim(), gaHandicap: Number(ga) || 0 });
    setFriends(store.friends());
    setName('');
    setGa('');
  };

  return (
    <div className="screen">
      <Header title="Friends" onBack={() => go({ name: 'home' })} />
      <div className="content">
        <Card title="Add a mate">
          <form className="row gap" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <input className="grow" placeholder="Name (as they'll set it in their app)" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="narrow-input" inputMode="decimal" placeholder="Hcp" value={ga} onChange={(e) => setGa(e.target.value)} />
            <button className="btn">Add</button>
          </form>
          <p className="muted small">Use the same name your mate uses in their own app, so shared rounds match up automatically. Tap a mate to add their GA number (or mark them as having no GA handicap).</p>
        </Card>
        <LiveFriendsCard go={go} />
        {inviting ? (
          <InviteSheet
            title="Get on Fairway Coach"
            intro={`${store.settings().me.name} wants you on Fairway Coach, the app for our scores, comps, live leaderboards and banter ⛳🍻 Tap the link to link up:`}
            url={inviting}
            onClose={() => setInviting(null)}
            personal
          />
        ) : (
          <button className="btn primary block" onClick={startInvite}>
            📲 Invite mates to the app
          </button>
        )}
        <PasteInvite />
        <Card title={`Your crew (${friends.length})`}>
          {friends.length === 0 && <p className="muted">No mates yet. Add them here or when you set up a round.</p>}
          <ul className="list">
            {[...friends].sort((a, b) => a.name.localeCompare(b.name)).map((f) => {
              const h = headToHead(rounds, 'me', f.id);
              return (
                <li key={f.id}>
                  <button className="list-btn" onClick={() => go({ name: 'friend', id: f.id })}>
                    <div>
                      <strong>{f.name}</strong>
                      <div className="muted small">
                        {handicapLabel(f)}
                        {f.hcpSource !== 'manual' && f.gaNumber && (!f.hcpCheckedAt || Date.now() - f.hcpCheckedAt > STALE_MS) ? ' · ⏰ check' : ''}
                        {h.rounds ? ` · you're ${h.wins}-${h.losses}-${h.halves} in ${h.rounds} round${h.rounds > 1 ? 's' : ''}` : ''}
                      </div>
                    </div>
                    <span>›</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </div>
  );
}

export function FriendDetail({ go, id }: { go: Go; id: string }) {
  const [f, setF] = useState<Player | undefined>(store.friends().find((x) => x.id === id));
  const rounds = store.rounds();
  const me = store.settings().me;
  if (!f) {
    return (
      <div className="screen">
        <Header title="Friend" onBack={() => go({ name: 'friends' })} />
        <p className="content">Not found.</p>
      </div>
    );
  }
  const save = (p: Player) => {
    setF(p);
    store.saveFriend(p);
  };
  const h = headToHead(rounds, 'me', f.id);
  const together = rounds
    .filter((r) => r.completed && r.players.some((p) => p.id === f.id))
    .sort((a, b) => b.startedAt - a.startedAt);

  return (
    <div className="screen">
      <Header title={f.name} onBack={() => go({ name: 'friends' })} />
      <div className="content">
        <Card>
          <label className="field">
            <span>Name</span>
            <input value={f.name} onChange={(e) => save({ ...f, name: e.target.value })} />
          </label>
          <HandicapEditor player={f} onChange={save} />
        </Card>
        <Card title={`Head to head: ${me.name} v ${f.name}`}>
          {h.rounds === 0 ? (
            <p className="muted">No completed individual rounds together yet.</p>
          ) : (
            <>
              <div className="kpis">
                <div className="kpi"><div className="kpi-label">Wins</div><div className="kpi-value">{h.wins}</div></div>
                <div className="kpi"><div className="kpi-label">Losses</div><div className="kpi-value">{h.losses}</div></div>
                <div className="kpi"><div className="kpi-label">Halved</div><div className="kpi-value">{h.halves}</div></div>
              </div>
              <p className="small">
                Average Stableford: you {h.myAvg}, {f.name} {h.theirAvg}, over {h.rounds} round{h.rounds > 1 ? 's' : ''}.
              </p>
            </>
          )}
        </Card>
        <Card title="Rounds together">
          <ul className="list">
            {together.length === 0 && <li className="muted">None yet.</li>}
            {together.map((r) => {
              const res = computeResult(r);
              const row = res.rows.find((x) => x.id === f.id) ?? res.rows.find((x) => r.teams?.find((t) => t.id === x.id)?.playerIds.includes(f.id));
              return (
                <li key={r.id}>
                  <button className="list-btn" onClick={() => go({ name: 'summary', roundId: r.id })}>
                    <div>
                      <strong>{r.courseName}</strong>
                      <div className="muted small">{new Date(r.date).toLocaleDateString('en-AU')} · {FORMAT_LABELS[r.format]}</div>
                    </div>
                    {row && <span className="score-pill">{r.format === 'ambrose' ? `net ${row.net}` : `${row.points} pts`}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
        <button
          className="btn danger ghost"
          onClick={() => {
            if (confirm(`Remove ${f.name}? Their past rounds stay.`)) {
              store.deleteFriend(f.id);
              go({ name: 'friends' });
            }
          }}
        >
          Remove friend
        </button>
      </div>
    </div>
  );
}
