import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { store, uid } from '../lib/storage';
import { applyBundle, autoMap, decodeBundle, type Bundle } from '../lib/share';
import { liveAvailable } from '../live/config';
import { HandicapEditor } from '../components/HandicapEditor';
import { InstallFirst } from '../components/InstallFirst';
import { Card, Header, type Go } from '../components/ui';

/** A mate's app invite: link up as friends on both phones. */
export function FriendJoin({ go, data }: { go: Go; data: string }) {
  const settings = store.settings();
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState(settings.me.name === 'Me' ? '' : settings.me.name);
  const [hcp, setHcp] = useState(settings.me);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    decodeBundle(data)
      .then(setBundle)
      .catch((e) => setErr(e instanceof Error ? e.message : 'That link looks broken or incomplete.'));
  }, [data]);

  const link = async () => {
    if (!bundle || !name.trim()) return;
    setBusy(true);
    try {
      const me = { ...hcp, id: settings.me.id, name: name.trim() };
      store.saveSettings({ ...store.settings(), me });
      const plan = applyBundle({ ...bundle, rounds: [], comps: [] }, autoMap(bundle, me, store.friends()), uid);
      plan.newFriends.forEach((f) => store.saveFriend(f));
      let told = false;
      if (bundle.crew && liveAvailable()) {
        try {
          const { announceLinkUp } = await import('../live/crewChannel');
          await announceLinkUp(bundle.crew, me);
          told = true;
        } catch {
          told = false;
        }
      }
      history.replaceState(null, '', location.pathname);
      setDone(told ? `You're now mates with ${bundle.from} on Fairway Coach, and you'll show up in ${bundle.from}'s Friends.` : `${bundle.from} is in your Friends now.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <Header title="Link up" onBack={() => go({ name: 'home' })} />
      <div className="content">
        {err && <p className="error">{err}</p>}
        {!bundle && !err && <p className="muted">Opening the invite…</p>}
        {bundle && !done && (
          <>
            <InstallFirst />
            <Card className="join-hero">
              <div className="eyebrow">
                <Users /> {bundle.from} invited you
              </div>
              <h2>Link up with {bundle.from}</h2>
              <p className="small">You'll be in each other's Friends, ready for rounds, comps, live scores and banter.</p>
            </Card>
            <Card title="Your details">
              <label className="field">
                <span>Your name (the one your mates know you by)</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam" autoComplete="name" />
              </label>
              <HandicapEditor player={hcp} onChange={setHcp} />
              <button className="btn primary block" disabled={busy || !name.trim()} onClick={link}>
                {busy ? 'Linking up…' : `Link up with ${bundle.from}`}
              </button>
            </Card>
          </>
        )}
        {done && (
          <Card className="join-hero">
            <h2>Sorted 🤝</h2>
            <p>{done}</p>
            <button className="btn primary block" onClick={() => go({ name: 'home' })}>
              Let's go
            </button>
          </Card>
        )}
      </div>
    </div>
  );
}
