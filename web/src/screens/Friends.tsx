import { useEffect, useState } from 'react';
import type { Format, Player } from '../types';
import { planRoundWith } from './Setup';
import { store, uid } from '../lib/storage';
import { headToHead } from '../lib/comps';
import { computeResult, FORMAT_LABELS } from '../lib/scoring';
import { Card, Header, type Go } from '../components/ui';
import { InviteSheet } from '../components/InviteSheet';
import { PasteInvite } from '../components/PasteInvite';
import { isIOS, isStandalone } from '../lib/install';
import { LiveFriendsCard } from '../components/LiveFriendsCard';
import { gaHandicapUrl, HandicapEditor, handicapLabel, parseHcp, STALE_MS } from '../components/HandicapEditor';

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
    const { myFriendInviteUrl } = await import('../live/crewChannel');
    setInviting(await myFriendInviteUrl());
  };
  const rounds = store.rounds();
  const [picked, setPicked] = useState<string[]>([]);
  const names = (ids: string[]) => {
    const n = ids.map((id) => friends.find((f) => f.id === id)?.name ?? '').filter(Boolean);
    return n.length > 1 ? `${n.slice(0, -1).join(', ')} & ${n[n.length - 1]}` : n[0] ?? '';
  };
  const teeOff = (format?: Format) => {
    planRoundWith(picked, format);
    go({ name: 'setup' });
  };

  const add = () => {
    if (!name.trim()) return;
    store.saveFriend({ id: uid(), name: name.trim(), gaHandicap: parseHcp(ga) ?? 0 });
    setFriends(store.friends());
    setName('');
    setGa('');
  };

  return (
    <div className="screen">
      <Header title="Friends" onBack={() => go({ name: 'home' })} />
      <div className="content">
        <LiveFriendsCard go={go} />
        {isIOS() && !isStandalone() && friends.length > 0 && <MoveToApp />}
        <Card title={`Your crew (${friends.length})`}>
          {friends.length === 0 && <p className="muted">No mates yet. Send an invite above, or add them here or when you set up a round.</p>}
          {friends.length > 0 && <p className="muted small">Tap ⛳ next to your mates to line them up, then tee off. Tap a name to see their details.</p>}
          {picked.length > 0 && (
            <div className="tee-off-bar">
              <button className="btn primary block" onClick={() => teeOff()}>
                ⛳ Tee off with {names(picked)}
              </button>
              {picked.length === 1 && (
                <button className="btn block" onClick={() => teeOff('matchplay')}>
                  🥊 Match play v {names(picked)}
                </button>
              )}
            </div>
          )}
          <ul className="list">
            {[...friends]
              .sort((a, b) => Number(isNew(b)) - Number(isNew(a)) || a.name.localeCompare(b.name))
              .map((f) => {
                const h = headToHead(rounds, 'me', f.id);
                const on = picked.includes(f.id);
                return (
                  <li key={f.id} className={`friend-row ${on ? 'on' : ''}`}>
                    <button className="list-btn" onClick={() => go({ name: 'friend', id: f.id })}>
                      <div>
                        <strong>{f.name}</strong>
                        {isNew(f) && <span className="new-badge">🆕 just linked up</span>}
                        <div className="muted small">
                          {handicapLabel(f)}
                          {f.hcpSource !== 'manual' && f.gaNumber && (!f.hcpCheckedAt || Date.now() - f.hcpCheckedAt > STALE_MS) ? ' · ⏰ check' : ''}
                          {h.rounds ? ` · you're ${h.wins}-${h.losses}-${h.halves} in ${h.rounds} round${h.rounds > 1 ? 's' : ''}` : ''}
                        </div>
                      </div>
                    </button>
                    <button
                      className={`pick-btn ${on ? 'on' : ''}`}
                      aria-label={on ? `Take ${f.name} out of the round` : `Add ${f.name} to a round`}
                      onClick={() => setPicked(on ? picked.filter((x) => x !== f.id) : [...picked, f.id].slice(0, 7))}
                    >
                      {on ? '✓' : '⛳'}
                    </button>
                  </li>
                );
              })}
          </ul>
        </Card>
        <Card title="Add a mate">
          <form className="row gap" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <input className="grow" placeholder="Name (as they'll set it in their app)" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="narrow-input" inputMode="decimal" placeholder="Hcp" value={ga} onChange={(e) => setGa(e.target.value)} />
            <button className="btn">Add</button>
          </form>
          <p className="muted small">Use the same name your mate uses in their own app, so shared rounds match up automatically. Tap a mate to add their GA number (or mark them as having no GA handicap).</p>
        </Card>
        {inviting ? (
          <>
          {/iPhone|iPad|iPod/.test(navigator.userAgent) && !isStandalone() && (
            <p className="warn small">
              ⚠️ You're in Safari. On iPhone, Safari and the Fairway Coach app on your Home Screen keep separate lists, so mates who accept this invite land in Safari's list. If you use the Home Screen app, send invites from there.
            </p>
          )}
          <InviteSheet
            title="Get on Fairway Coach"
            intro={`${store.settings().me.name} wants you on Fairway Coach, the app for our scores, comps, live leaderboards and banter ⛳🍻 Tap the link to link up:`}
            url={inviting}
            onClose={() => setInviting(null)}
            personal
          />
          </>
        ) : (
          <button className="btn primary block" onClick={startInvite}>
            📲 Invite mates to the app
          </button>
        )}
        <PasteInvite />
      </div>
    </div>
  );
}

/** In Safari on iPhone: copy these friends across to the Home Screen app (they keep separate lists). */
function MoveToApp() {
  const [done, setDone] = useState<'copied' | 'shared' | null>(null);
  // Built up front: Safari only lets a tap copy straight away
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    import('../live/crewChannel').then(({ myMoveFriendsUrl }) => myMoveFriendsUrl()).then(setUrl).catch(() => undefined);
  }, []);
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setDone('copied');
    } catch {
      prompt('Copy this link:', url);
      setDone('copied');
    }
  };
  return (
    <Card title="Use the app on your Home Screen?">
      <p className="small">
        You're in Safari. On iPhone, Safari and the Fairway Coach app on your Home Screen keep <strong>separate friend lists</strong>. Move these mates across in two taps:
      </p>
      <button className="btn primary block" disabled={!url} onClick={copy}>
        📲 {done ? 'Copied ✓ Now open the app' : 'Copy my friends for the app'}
      </button>
      <p className="muted small">
        Then open Fairway Coach from your Home Screen → <strong>Friends</strong> → <strong>Paste an invite</strong>. Mates who accept invites you sent from Safari will show up in the app from then on too.
      </p>
    </Card>
  );
}

/** Linked up in the last two days. */
function isNew(f: Player) {
  return !!f.linkedAt && Date.now() - f.linkedAt < 2 * 24 * 3600 * 1000;
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
        {f.crew ? (
          // Linked up: their details are theirs to change, on their own phone
          <Card>
            <div className="linked-head">
              <strong className="linked-name">{f.name}</strong>
              <span className="linked-badge">🔗 Linked</span>
            </div>
            <p className="small">
              <strong>{handicapLabel(f)}</strong>
              {f.gaNumber ? ` · GA no. ${f.gaNumber}` : ''}
            </p>
            {f.gaNumber && f.hcpSource !== 'manual' && (
              <a className="btn block" href={gaHandicapUrl(f.gaNumber)} target="_blank" rel="noreferrer">
                Check it on Golf Australia
              </a>
            )}
            <p className="muted small">{f.name} looks after their own name and handicap on their phone. When they change it, it updates here by itself, so everyone's playing off the right number.</p>
          </Card>
        ) : (
          <Card>
            <label className="field">
              <span>Name</span>
              <input value={f.name} onChange={(e) => save({ ...f, name: e.target.value })} />
            </label>
            <HandicapEditor player={f} onChange={save} />
            <p className="muted small">Added by you. Once {f.name || 'they'} link up with your invite, they look after these details themselves.</p>
          </Card>
        )}
        <div className="row gap">
          <button className="btn primary grow" onClick={() => { planRoundWith([f.id]); go({ name: 'setup' }); }}>
            ⛳ Play a round with {f.name}
          </button>
          <button className="btn grow" onClick={() => { planRoundWith([f.id], 'matchplay'); go({ name: 'setup' }); }}>
            🥊 Match play
          </button>
        </div>
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
