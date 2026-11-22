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
  const [sendBack, setSendBack] = useState(false);
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
      // Your own invite, opened in your other copy of the app (Safari vs Home Screen on iPhone)
      if (personKey(bundle.from) === personKey(name)) {
        const { addExtraCrewCode } = await import('../live/crewChannel');
        if (bundle.crew) addExtraCrewCode(bundle.crew);
        history.replaceState(null, '', location.pathname);
        window.dispatchEvent(new Event('gtg:friends'));
        setDone("That's your own invite 👍 Mates who accept invites you sent from your other copy of the app (like Safari) will now show up here too. To bring across mates already linked there, open Friends in Safari and tap \"Copy my friends for the app\".");
        return;
      }
      const me = { ...hcp, id: settings.me.id, name: name.trim() };
      store.saveSettings({ ...store.settings(), me });
      const plan = applyBundle({ ...bundle, rounds: [], comps: [] }, autoMap(bundle, me, store.friends()), uid);
      plan.newFriends.forEach((f) => store.saveFriend(personKey(f.name) === personKey(bundle.from) ? { ...f, ...(bundle.crew ? { crew: bundle.crew } : {}), linkedAt: Date.now() } : f));
      // Already friends? Just pick up their crew code
      const known = store.friends().find((f) => personKey(f.name) === personKey(bundle.from));
      if (known && bundle.crew && known.crew !== bundle.crew) store.saveFriend({ ...known, crew: bundle.crew });
      let told = false;
      if (bundle.crew && liveAvailable()) {
        const { linkUpWithRetry } = await import('../live/crewChannel');
        told = await linkUpWithRetry(bundle.crew, me);
      }
      history.replaceState(null, '', location.pathname);
      setSendBack(!told);
      setDone(
        told
          ? `You're now mates with ${bundle.from} on Shotmate, and you'll show up in ${bundle.from}'s Friends.`
          : bundle.crew && liveAvailable()
            ? `${bundle.from} is in your Friends now. We couldn't reach ${bundle.from}'s phone just yet (signal?), so we'll keep trying. To be sure, send ${bundle.from} your link too:`
            : `${bundle.from} is in your Friends now. This invite is an older one, so send ${bundle.from} your link back and you'll land on their list too:`,
      );
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
            {sendBack && bundle && (
              <button
                className="btn primary block"
                onClick={async () => {
                  const { myFriendInviteUrl } = await import('../live/crewChannel');
                  const { shareLink } = await import('../lib/share');
                  await shareLink('Shotmate', `It's ${store.settings().me.name}. Tap to add me to your Friends on Shotmate:`, await myFriendInviteUrl());
                }}
              >
                🔗 Send {bundle.from} my link
              </button>
            )}
            <InstallFirst after link={inviteLink} />
            <button className={`btn block ${sendBack ? '' : 'primary'}`} onClick={() => go({ name: 'home' })}>
              Let's go
            </button>
          </Card>
        )}
      </div>
    </div>
  );
}
