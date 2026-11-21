import { useEffect, useState } from 'react';
import type { Aids, Competition } from '../types';
import { store, uid } from '../lib/storage';
import { AIDS_BLURB, AIDS_LABELS, COMP_PRESETS, computeComp, newComp, SCORING_BLURB, SCORING_LABELS, standingsText, valueLabel } from '../lib/comps';
import { encodeBundle, joinUrl, makeBundle, personKey, shareLink, shareText, shareUrl } from '../lib/share';
import { Card, Header, Segmented, type Go } from '../components/ui';
import { liveAvailable } from '../live/config';
import { CompLive } from '../components/CompLive';
import { InviteSheet } from '../components/InviteSheet';
import type { LiveRoundNote } from '../live/compChannel';
import { lastSeen, type ChatMsg } from '../live/chat';

const nameOf = (id: string) => store.nameOf(id);

export function Leaderboards({ go }: { go: Go }) {
  const comps = store.comps();
  const rounds = store.rounds();
  const friends = store.friends();

  // All-time: every individual round with 2+ of the crew, ranked on average Stableford
  const everyone = ['me', ...friends.map((f) => f.id)];
  const allTime = newComp('__all', everyone, { scoring: 'stableford_avg', start: '0000-01-01', minPlayers: 2, minRounds: 1 });
  const allRes = computeComp(allTime, rounds.map((r) => ({ ...r, compIds: ['__all'] })), nameOf);

  return (
    <div className="screen">
      <Header title="Leaderboards" onBack={() => go({ name: 'home' })} />
      <div className="content">
        <button className="btn primary block big" onClick={() => go({ name: 'compEdit' })}>
          + New comp
        </button>
        {comps.length === 0 && (
          <Card>
            <p>
              Set up a comp for your regular group (e.g. a Friday Arvo League over the next 10 rounds) and every round you tag counts towards the table.
            </p>
          </Card>
        )}
        {comps.map((c) => {
          const res = computeComp(c, rounds, nameOf);
          const leader = res.standings.find((s) => s.played);
          return (
            <Card key={c.id}>
              <button className="list-btn" onClick={() => go({ name: 'comp', id: c.id })}>
                <div>
                  <div className="eyebrow">
                    {res.status === 'complete' ? '🏁 Final' : res.status === 'upcoming' ? '⏳ Starts ' + c.start : '🟢 Live'} · {res.rounds.length} round{res.rounds.length === 1 ? '' : 's'}
                    {res.remaining != null && res.status !== 'complete' ? ` · ${res.remaining} to go` : ''}
                  </div>
                  <strong>{c.name}</strong>
                  <div className="muted small">{leader ? `${res.status === 'complete' ? 'Winner' : 'Leader'}: ${leader.name}, ${valueLabel(c, leader)}` : 'No rounds yet'}</div>
                </div>
                <span>›</span>
              </button>
            </Card>
          );
        })}
        <Card title="All-time: average Stableford">
          {allRes.standings.every((s) => !s.played) ? (
            <p className="muted">Play some rounds with your mates and the all-time table fills in.</p>
          ) : (
            <StandingsTable comp={allTime} standings={allRes.standings} />
          )}
          <p className="muted small">Every completed individual round with at least two of your crew.</p>
        </Card>
      </div>
    </div>
  );
}

export function StandingsTable({ comp, standings }: { comp: Competition; standings: ReturnType<typeof computeComp>['standings'] }) {
  const shown = standings.filter((s) => s.played);
  const firstUnq = shown.findIndex((s) => !s.qualified);
  return (
    <table className="totals standings">
      <thead>
        <tr>
          <th>#</th>
          <th>Player</th>
          <th>{comp.scoring === 'league' ? 'Pts' : comp.scoring === 'stableford_total' ? 'Total' : 'Avg'}</th>
          <th>Rds</th>
          <th>Wins</th>
          <th>Form</th>
        </tr>
      </thead>
      <tbody>
        {shown.map((s, i) => (
          <tr key={s.playerId} className={`${s.playerId === 'me' ? 'me' : ''} ${i === firstUnq ? 'cutline' : ''}`}>
            <td>{s.qualified ? (s.rank === 1 ? '🥇' : s.rank === 2 ? '🥈' : s.rank === 3 ? '🥉' : s.rank) : '–'}</td>
            <td>
              {s.name}
              {!s.qualified && <small> (needs {comp.minRounds} rds)</small>}
            </td>
            <td>
              <strong>{s.value}</strong>
            </td>
            <td>
              {s.played}
              {s.counted !== s.played && <small> ({s.counted} count)</small>}
            </td>
            <td>{s.wins}</td>
            <td className="form">
              {s.form.map((p, j) => (
                <span key={j} className={`form-dot p${Math.min(p, 4)}`}>
                  {p}
                </span>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CompDetail({ go, id }: { go: Go; id: string }) {
  const [rev, setRev] = useState(0);
  const comp = store.comp(id);
  const [msg, setMsg] = useState<string | null>(null);
  const [liveNotes, setLiveNotes] = useState<LiveRoundNote[]>([]);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  // Latest banter, for the preview and the "new" count
  useEffect(() => {
    if (!liveAvailable()) return;
    let unsub: (() => void) | undefined;
    let stop = false;
    import('../live/chat')
      .then(({ watchChat }) => watchChat(id, (m) => !stop && setChat(m), 30))
      .then((u) => (stop ? u() : (unsub = u)))
      .catch(() => undefined);
    return () => {
      stop = true;
      unsub?.();
    };
  }, [id]);
  // Mates who joined from an invite link show up here by themselves
  useEffect(() => {
    const c = store.comp(id);
    if (!c || !liveAvailable()) return;
    let unsub: (() => void) | undefined;
    let stop = false;
    import('../live/compChannel').then(async ({ watchJoiners, addJoiners }) => {
      const { applyRules } = await import('../live/compChannel');
      const u = await watchJoiners(c, (joiners, live, rules) => {
        setLiveNotes(live);
        if (applyRules(store.comp(id) ?? c, rules)) setRev((n) => n + 1);
        const { added } = addJoiners(store.comp(id) ?? c, joiners);
        if (added.length) {
          setMsg(`${added.join(' and ')} joined the comp.`);
          setRev((n) => n + 1);
        }
      });
      if (stop) u();
      else unsub = u;
    }).catch(() => undefined);
    return () => {
      stop = true;
      unsub?.();
    };
  }, [id]);
  void rev;
  if (!comp) {
    return (
      <div className="screen">
        <Header title="Comp" onBack={() => go({ name: 'leaderboards' })} />
        <p className="content">Comp not found.</p>
      </div>
    );
  }
  const rounds = store.rounds();
  const res = computeComp(comp, rounds, nameOf);

  const compBundle = () => {
    const settings = store.settings();
    const counted = res.rounds.map((r) => r.round);
    return { counted, b: makeBundle({ me: settings.me, friends: store.friends(), rounds: counted, comps: [comp] }) };
  };
  const invite = async () => {
    const { b } = compBundle();
    let url = joinUrl(await encodeBundle(b));
    // A long season makes a long link; for texts keep it to the comp and who's in (rounds sync live)
    if (url.length > 1800) url = joinUrl(await encodeBundle({ ...b, rounds: [] }));
    setInviteUrl(url);
  };
  const shareComp = async () => {
    const { counted, b } = compBundle();
    const how = await shareLink(comp.name, `"${comp.name}" in Fairway Coach (${counted.length} round${counted.length === 1 ? '' : 's'} so far). Tap to update your table:`, shareUrl(await encodeBundle(b)));
    setMsg(how === 'copied' ? 'Link copied. Paste it in the group chat.' : null);
  };
  const members = comp.memberIds.map((m) => nameOf(m));
  // Rounds for this comp being played right now: this phone's, and anyone else's that's live
  const localLive = rounds.find((r) => !r.completed && r.compIds?.includes(comp.id) && Date.now() - r.startedAt < 12 * 3600 * 1000);
  const otherLive = liveNotes.filter((n, i, a) => n.code !== localLive?.liveCode && a.findIndex((x) => x.code === n.code) === i);
  const seen = lastSeen(comp.id);
  const unread = chat.filter((m) => !m.mine && m.id > seen).length;
  const lastMsg = chat[chat.length - 1];
  const shareTable = async () => {
    const how = await shareText(comp.name, standingsText(comp, res));
    setMsg(how === 'copied' ? 'Table copied. Paste it in the group chat.' : null);
  };

  return (
    <div className="screen">
      <Header title={comp.name} onBack={() => go({ name: 'leaderboards' })} right={<button className="btn small" onClick={() => go({ name: 'compEdit', id: comp.id })}>Edit</button>} />
      <div className="content">
        {localLive && <CompLive comp={comp} local={localLive} code={localLive.liveCode} go={go} />}
        {otherLive.map((n) => (
          <CompLive key={n.code} comp={comp} code={n.code} course={n.course} scorer={n.scorer} go={go} />
        ))}
        {liveAvailable() && (
          <button className="banter-btn" onClick={() => go({ name: 'chat', compId: comp.id })}>
            <span className="banter-icon">💬</span>
            <span className="grow">
              <strong>Banter</strong>
              <span className="muted small banter-last">
                {lastMsg ? `${lastMsg.mine ? 'You' : lastMsg.name}: ${lastMsg.text}` : 'Start stirring the pot 🔥'}
              </span>
            </span>
            {unread > 0 && <span className="badge">{unread}</span>}
            <span>›</span>
          </button>
        )}
        <Card>
          <div className="eyebrow">
            {res.status === 'complete' ? '🏁 Final standings' : res.status === 'upcoming' ? `⏳ Starts ${comp.start}` : '🟢 Live'} · {SCORING_LABELS[comp.scoring]}
          </div>
          <p className="small muted">
            {comp.start}
            {comp.end ? ` to ${comp.end}` : ' onwards'}
            {comp.roundLimit ? ` · ${comp.roundLimit} rounds (${res.remaining} to go)` : ''}
            {comp.countBest ? ` · best ${comp.countBest} count` : ''}
            {comp.scoring === 'league' ? ` · points ${comp.pointsTable.join('/')}${comp.participationPoints ? ` +${comp.participationPoints} for playing` : ''}${comp.birdieBonus ? ` +${comp.birdieBonus} per birdie` : ''}` : ''}
          </p>
          {res.rounds.length === 0 ? (
            <p className="muted">No rounds counted yet. When you set up a round, tick this comp under "Counts towards".</p>
          ) : (
            <StandingsTable comp={comp} standings={res.standings} />
          )}
          <p className="small">
            <strong>In the comp:</strong> {members.join(', ')}
          </p>
          {(comp.aids ?? 'full') !== 'full' && (
            <p className="small rules-note">
              🏆 <strong>Tournament rules: {AIDS_LABELS[comp.aids!]}.</strong> {AIDS_BLURB[comp.aids!]}
            </p>
          )}
          {inviteUrl ? (
            <InviteSheet
              title={`Join ${comp.name}`}
              intro={`${store.settings().me.name} has invited you to "${comp.name}" on Fairway Coach, our golf scoring and comp app ⛳🏆 Tap the link to join:`}
              url={inviteUrl}
              onClose={() => setInviteUrl(null)}
              personal
            />
          ) : (
            <button className="btn primary block" onClick={invite}>
              ➕ Invite a mate to join
            </button>
          )}
          <div className="row gap wrap">
            <button className="btn" onClick={shareTable} disabled={!res.rounds.length}>
              💬 Share table
            </button>
            <button className="btn" onClick={shareComp}>
              🔄 Sync rounds
            </button>
          </div>
          {msg && <p className="ok small">{msg}</p>}
          <p className="muted small">
            "Invite" sends a link your mate taps to join; {liveAvailable() ? 'they appear here by themselves.' : 'they send an "I\'m in" link back.'} "Sync rounds" sends everyone the latest rounds so all your phones show the same table.
          </p>
        </Card>

        <Card title="Round by round">
          {[...res.rounds].reverse().map((cr) => (
            <div key={cr.round.id} className="comp-round">
              <button className="list-btn" onClick={() => go({ name: 'summary', roundId: cr.round.id })}>
                <div>
                  <strong>{cr.round.courseName}</strong>
                  <div className="muted small">
                    {new Date(cr.round.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}
                    {cr.round.format === 'ambrose' ? ' · Ambrose' : ''}
                    {cr.round.sharedBy ? ` · from ${cr.round.sharedBy}` : ''}
                  </div>
                </div>
                <span>›</span>
              </button>
              <ol className="mini-results">
                {cr.entries.map((e) => (
                  <li key={e.playerId}>
                    <span className="pos">{e.position}</span> {e.name}{' '}
                    <span className="muted small">
                      {e.stableford != null ? `${e.stableford} stb` : `net ${e.net}`}
                      {comp.scoring === 'league' ? ` → ${e.points} pts` : ''}
                      {e.birdies ? ` · 🐦${e.birdies}` : ''}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
          {res.rounds.length === 0 && <p className="muted">Nothing yet.</p>}
        </Card>
      </div>
    </div>
  );
}

export function CompEditor({ go, id }: { go: Go; id?: string }) {
  const friends = store.friends();
  const myName = store.settings().me.name;
  const [c, setC] = useState<Competition>(
    () => store.comp(id ?? '') ?? newComp(uid(), ['me', ...friends.map((f) => f.id)], { ...COMP_PRESETS[0].make(), organiser: myName }),
  );
  // Only whoever set the comp up can change the tournament rules
  const isOrganiser = !c.organiser || personKey(c.organiser) === personKey(myName);
  const set = (p: Partial<Competition>) => setC({ ...c, ...p });
  const people = [{ id: 'me', name: store.settings().me.name }, ...friends];
  const num = (v: string) => (v.trim() === '' ? undefined : Math.max(0, Number(v) || 0));
  const isNew = !store.comp(c.id);

  const save = () => {
    const saved = isOrganiser ? { ...c, organiser: c.organiser ?? myName } : c;
    store.saveComp(saved);
    if (isOrganiser && liveAvailable()) import('../live/compChannel').then(({ publishRules }) => publishRules(saved, myName)).catch(() => undefined);
    // Tag already-finished rounds in the date range that have enough members, so the table starts populated
    if (isNew) {
      for (const r of store.rounds()) {
        const d = new Date(r.date);
        const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const inRange = day >= c.start && (!c.end || day <= c.end);
        const members = r.players.filter((p) => c.memberIds.includes(p.id)).length;
        if (r.completed && inRange && members >= c.minPlayers && !r.compIds?.includes(c.id)) {
          store.saveRound({ ...r, compIds: [...(r.compIds ?? []), c.id] });
        }
      }
    }
    go({ name: 'comp', id: c.id });
  };

  return (
    <div className="screen">
      <Header title={isNew ? 'New comp' : 'Edit comp'} onBack={() => go(isNew ? { name: 'leaderboards' } : { name: 'comp', id: c.id })} />
      <div className="content">
        {isNew && (
          <div className="row gap wrap">
            {COMP_PRESETS.map((p) => (
              <button key={p.label} className="chip" onClick={() => set(p.make())}>
                {p.label}
              </button>
            ))}
          </div>
        )}
        <Card title="The comp">
          <label className="field">
            <span>Name</span>
            <input value={c.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <div className="row gap">
            <label className="field grow">
              <span>Starts</span>
              <input type="date" value={c.start} onChange={(e) => set({ start: e.target.value })} />
            </label>
            <label className="field grow">
              <span>Ends (optional)</span>
              <input type="date" value={c.end ?? ''} onChange={(e) => set({ end: e.target.value || undefined })} />
            </label>
          </div>
          <div className="row gap">
            <label className="field grow">
              <span>Season length (rounds)</span>
              <input inputMode="numeric" placeholder="Unlimited" value={c.roundLimit ?? ''} onChange={(e) => set({ roundLimit: num(e.target.value) || undefined })} />
            </label>
            <label className="field grow">
              <span>Best N rounds count</span>
              <input inputMode="numeric" placeholder="All" value={c.countBest ?? ''} onChange={(e) => set({ countBest: num(e.target.value) || undefined })} />
            </label>
          </div>
          <div className="field">
            <span>Rounds</span>
            <Segmented value={c.holes} onChange={(v) => set({ holes: v })} options={[{ value: 'any', label: '9 or 18' }, { value: '18', label: '18 only' }, { value: '9', label: '9 only' }]} />
          </div>
          <label className="field narrow">
            <span>Min. players for a round to count</span>
            <input inputMode="numeric" value={c.minPlayers} onChange={(e) => set({ minPlayers: Math.max(1, Number(e.target.value) || 1) })} />
          </label>
        </Card>

        <Card title="Tournament rules">
          <div className="format-grid">
            {(['full', 'noCaddy', 'distancesOnly'] as Aids[]).map((k) => (
              <button key={k} disabled={!isOrganiser} className={`format ${(c.aids ?? 'full') === k ? 'on' : ''}`} onClick={() => set({ aids: k })}>
                {AIDS_LABELS[k]}
              </button>
            ))}
          </div>
          <p className="muted small">{AIDS_BLURB[c.aids ?? 'full']}</p>
          <p className="muted small">
            {isOrganiser
              ? 'Applies to every round that counts towards this comp, on everyone\'s phone.'
              : `Only ${c.organiser} (who set up the comp) can change this.`}
          </p>
        </Card>

        <Card title="Scoring">
          <div className="format-grid">
            {(Object.keys(SCORING_LABELS) as Competition['scoring'][]).map((k) => (
              <button key={k} className={`format ${c.scoring === k ? 'on' : ''}`} onClick={() => set({ scoring: k })}>
                {SCORING_LABELS[k]}
              </button>
            ))}
          </div>
          <p className="muted small">{SCORING_BLURB[c.scoring]}</p>
          {c.scoring === 'league' && (
            <>
              <label className="field">
                <span>Points for 1st, 2nd, 3rd…</span>
                <input
                  value={c.pointsTable.join(', ')}
                  onChange={(e) => set({ pointsTable: e.target.value.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n)) })}
                />
              </label>
              <div className="row gap">
                <label className="field grow">
                  <span>Points for playing</span>
                  <input inputMode="decimal" value={c.participationPoints} onChange={(e) => set({ participationPoints: Number(e.target.value) || 0 })} />
                </label>
                <label className="field grow">
                  <span>Bonus per birdie</span>
                  <input inputMode="decimal" value={c.birdieBonus} onChange={(e) => set({ birdieBonus: Number(e.target.value) || 0 })} />
                </label>
              </div>
            </>
          )}
          {(c.scoring === 'stableford_avg' || c.scoring === 'net_avg') && (
            <label className="field narrow">
              <span>Rounds needed to qualify</span>
              <input inputMode="numeric" value={c.minRounds} onChange={(e) => set({ minRounds: Math.max(1, Number(e.target.value) || 1) })} />
            </label>
          )}
          {c.scoring !== 'league' && <p className="muted small">Ambrose rounds only count in League mode (there's no individual score).</p>}
        </Card>

        <Card title={`Players (${c.memberIds.length})`}>
          <div className="row gap wrap">
            {people.map((p) => {
              const on = c.memberIds.includes(p.id);
              return (
                <button key={p.id} className={`chip ${on ? 'on' : ''}`} onClick={() => set({ memberIds: on ? c.memberIds.filter((x) => x !== p.id) : [...c.memberIds, p.id] })}>
                  {on ? '✓ ' : ''}
                  {p.name}
                </button>
              );
            })}
          </div>
          <button className="btn ghost small" onClick={() => go({ name: 'friends' })}>
            Manage friends
          </button>
        </Card>

        <button className="btn primary block big" disabled={!c.name.trim() || c.memberIds.length < 1} onClick={save}>
          {isNew ? 'Create comp' : 'Save'}
        </button>
        {!isNew && (
          <button
            className="btn danger ghost"
            onClick={() => {
              if (confirm(`Delete ${c.name}? Rounds stay, they just stop counting.`)) {
                store.deleteComp(c.id);
                go({ name: 'leaderboards' });
              }
            }}
          >
            Delete comp
          </button>
        )}
      </div>
    </div>
  );
}
