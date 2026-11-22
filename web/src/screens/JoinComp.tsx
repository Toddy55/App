import { useEffect, useRef, useState } from 'react';
import { Trophy } from 'lucide-react';
import { store, uid } from '../lib/storage';
import { applyBundle, autoMap, decodeBundle, encodeBundle, makeBundle, personKey, shareLink, shareUrl, type Bundle } from '../lib/share';
import { computeComp, SCORING_LABELS } from '../lib/comps';
import { liveAvailable } from '../live/config';
import { StandingsTable } from './Leaderboards';
import { HandicapEditor } from '../components/HandicapEditor';
import { InstallFirst } from '../components/InstallFirst';
import { learnCrews } from '../live/liveFriends';
import { Card, Header, type Go } from '../components/ui';

/** Someone opened a comp invite: show them the comp and let them join in one tap. */
export function JoinComp({ go, data, to }: { go: Go; data: string; to?: string }) {
  const settings = store.settings();
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // The inviter can put your name in the link, so a brand-new phone needn't type anything
  const invitedAs = to?.trim().slice(0, 40) || '';
  const [newPhone] = useState(() => !settings.me.name || settings.me.name === 'Me');
  const [name, setName] = useState(settings.me.name && settings.me.name !== 'Me' ? settings.me.name : invitedAs);
  const [hcp, setHcp] = useState(settings.me);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ compId: string; synced: boolean } | null>(null);

  useEffect(() => {
    decodeBundle(data)
      .then((b) => (b.comps.length ? setBundle(b) : setErr("This link doesn't have a comp in it.")))
      .catch((e) => setErr(e instanceof Error ? e.message : 'That link looks broken or incomplete.'));
  }, [data]);

  const comp = bundle?.comps[0];
  // Known on this phone already? Join straight away
  const knownName = settings.me.name && settings.me.name !== 'Me' ? settings.me.name : invitedAs || null;
  const autoRan = useRef(false);
  const [inviteLink] = useState(() => location.href);
  useEffect(() => {
    if (bundle?.comps.length && knownName && !autoRan.current) {
      autoRan.current = true;
      join();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle]);
  const already = !!comp && !!store.comp(comp.id)?.memberIds.includes('me');
  const preview = comp && bundle ? computeComp(comp, bundle.rounds, (k) => bundle.people.find((p) => p.key === k)?.name ?? k) : null;
  const memberNames = comp && bundle ? comp.memberIds.map((k) => bundle.people.find((p) => p.key === k)?.name ?? k) : [];

  const join = async () => {
    if (!bundle || !comp || !name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      // Who am I? Save it so shared rounds match up from now on
      const me = { ...hcp, id: settings.me.id, name: name.trim() };
      store.saveSettings({ ...settings, me });
      const plan = applyBundle(bundle, autoMap(bundle, me, store.friends()), uid);
      plan.newFriends.forEach((f) => store.saveFriend(f));
      learnCrews(bundle);
      for (const r of plan.rounds) if (!store.round(r.id)) store.saveRound(r);
      for (const c of plan.comps) {
        const mine = store.comp(c.id);
        const members = new Set([...(mine?.memberIds ?? []), ...c.memberIds]);
        if (c.id === comp.id) members.add('me');
        store.saveComp({ ...(mine ?? c), ...c, memberIds: [...members] });
      }
      let synced = false;
      if (liveAvailable()) {
        try {
          const { announceJoin } = await import('../live/compChannel');
          await announceJoin(store.comp(comp.id)!, me);
          synced = true;
        } catch {
          synced = false;
        }
      }
      history.replaceState(null, '', location.pathname);
      setDone({ compId: comp.id, synced });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // No live sync: send the organiser a link back so they can add you
  const replyLink = async () => {
    if (!done) return;
    const c = store.comp(done.compId)!;
    const s = store.settings();
    const b = makeBundle({ me: s.me, friends: store.friends(), rounds: [], comps: [c] });
    await shareLink(c.name, `I'm in "${c.name}". Tap to add me:`, shareUrl(await encodeBundle(b)));
  };

  return (
    <div className="screen">
      <Header title="Join a comp" onBack={() => go({ name: 'home' })} />
      <div className="content">
        {err && <p className="error">{err}</p>}
        {!bundle && !err && <p className="muted">Opening the invite…</p>}
        {comp && bundle && !done && knownName && <p className="muted">Joining {comp.name}…</p>}
        {comp && bundle && !done && !knownName && (
          <>
            <Card className="join-hero">
              <div className="eyebrow">
                <Trophy /> {bundle.from} invited you
              </div>
              <h2>{comp.name}</h2>
              <p className="muted small">
                {SCORING_LABELS[comp.scoring]} · from {comp.start}
                {comp.end ? ` to ${comp.end}` : ''}
                {comp.roundLimit ? ` · ${comp.roundLimit} rounds` : ''}
                {comp.countBest ? ` · best ${comp.countBest} count` : ''}
              </p>
              {memberNames.length > 0 && <p className="small">In so far: {memberNames.join(', ')}</p>}
            </Card>
            {preview && preview.rounds.length > 0 && (
              <Card title="Table so far">
                <StandingsTable comp={comp} standings={preview.standings} />
              </Card>
            )}
            <Card title={already ? "You're already in this comp" : 'Your details'}>
              <label className="field">
                <span>Your name (the one your mates know you by)</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam" autoComplete="name" />
              </label>
              <details className="small">
                <summary className="muted">Add your handicap now (optional, or later in Settings)</summary>
                <HandicapEditor player={hcp} onChange={setHcp} />
              </details>
              {name.trim() && memberNames.some((n) => personKey(n) === personKey(name)) && !already && (
                <p className="muted small">You're already on their list as {name.trim()}, so this links you up.</p>
              )}
              <button className="btn primary block" disabled={busy || !name.trim()} onClick={join}>
                {busy ? 'Joining…' : already ? 'Update my copy of the comp' : `Join ${comp.name}`}
              </button>
            </Card>
          </>
        )}
        {done && (
          <Card className="join-hero">
            <h2>You're in 🎉</h2>
            {invitedAs && newPhone && <p className="muted small">You're set up as {invitedAs}. Not right? Change it in Settings.</p>}
            <InstallFirst after link={inviteLink} />
            {done.synced ? (
              <p>Everyone in the comp will see your name next time they open it. Tick the comp under "Counts towards" when you set up a round.</p>
            ) : (
              <>
                <p>Send the organiser this link so they can add you to their table:</p>
                <button className="btn primary block" onClick={replyLink}>
                  🔗 Send "I'm in"
                </button>
              </>
            )}
            <button className="btn block" onClick={() => go({ name: 'comp', id: done.compId })}>
              Open the comp
            </button>
          </Card>
        )}
      </div>
    </div>
  );
}
