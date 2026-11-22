import { useEffect, useRef, useState } from 'react';
import { Users } from 'lucide-react';
import { store, uid } from '../lib/storage';
import { applyBundle, autoMap, decodeBundle, personKey, type Bundle } from '../lib/share';
import { liveAvailable } from '../live/config';
import { HandicapEditor } from '../components/HandicapEditor';
import { InstallFirst } from '../components/InstallFirst';
import { Card, Header, type Go } from '../components/ui';

/** A mate's app invite: link up as friends on both phones. */
export function FriendJoin({ go, data, to }: { go: Go; data: string; to?: string }) {
  const settings = store.settings();
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // The inviter can put your name in the link, so a brand-new phone needn't type anything
  const invitedAs = to?.trim().slice(0, 40) || '';
  const [newPhone] = useState(() => !settings.me.name || settings.me.name === 'Me');
  const [name, setName] = useState(settings.me.name && settings.me.name !== 'Me' ? settings.me.name : invitedAs);
  const [hcp, setHcp] = useState(settings.me);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  // If this phone already knows who you are, link up straight away: no form, no button
  const knownName = settings.me.name && settings.me.name !== 'Me' ? settings.me.name : invitedAs || null;
  const autoRan = useRef(false);
  const [inviteLink] = useState(() => location.href);

  useEffect(() => {
    decodeBundle(data)
      .then(setBundle)
      .catch((e) => setErr(e instanceof Error ? e.message : 'That link looks broken or incomplete.'));
  }, [data]);

  useEffect(() => {
    if (bundle && knownName && !autoRan.current) {
      autoRan.current = true;
      link();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle]);

  const link = async () => {
    if (!bundle || !name.trim()) return;
    setBusy(true);
    try {
      const me = { ...hcp, id: settings.me.id, name: name.trim() };
      store.saveSettings({ ...store.settings(), me });
      const plan = applyBundle({ ...bundle, rounds: [], comps: [] }, autoMap(bundle, me, store.friends()), uid);
      plan.newFriends.forEach((f) => store.saveFriend(bundle.crew && personKey(f.name) === personKey(bundle.from) ? { ...f, crew: bundle.crew } : f));
      // Already friends? Just pick up their crew code
      const known = store.friends().find((f) => personKey(f.name) === personKey(bundle.from));
      if (known && bundle.crew && known.crew !== bundle.crew) store.saveFriend({ ...known, crew: bundle.crew });
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
        {bundle && !done && knownName && <p className="muted">Linking you up with {bundle.from}…</p>}
        {bundle && !done && !knownName && (
          <>
            <Card className="join-hero">
              <div className="eyebrow">
                <Users /> {bundle.from} invited you
              </div>
              <h2>Link up with {bundle.from}</h2>
              <p className="small">You'll be in each other's Friends, ready for rounds, comps, live scores and banter.</p>
            </Card>
            <Card title="What's your name?">
              <form
                className="row gap"
                onSubmit={(e) => {
                  e.preventDefault();
                  link();
                }}
              >
                <input className="grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam" autoComplete="name" autoFocus />
                <button className="btn primary" disabled={busy || !name.trim()}>
                  {busy ? '…' : 'Done'}
                </button>
              </form>
              <details className="small">
                <summary className="muted">Add your handicap now (optional, or later in Settings)</summary>
                <HandicapEditor player={hcp} onChange={setHcp} />
              </details>
            </Card>
          </>
        )}
        {done && (
          <Card className="join-hero">
            <h2>Sorted 🤝</h2>
            {invitedAs && newPhone && <p className="muted small">You're set up as {invitedAs}. Not right? Change it in Settings.</p>}
            <p>{done}</p>
            <InstallFirst after link={inviteLink} />
            <button className="btn primary block" onClick={() => go({ name: 'home' })}>
              Let's go
            </button>
          </Card>
        )}
      </div>
    </div>
  );
}
