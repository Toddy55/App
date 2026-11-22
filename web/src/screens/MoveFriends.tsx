import { useEffect, useRef, useState } from 'react';
import { Users } from 'lucide-react';
import { Card, Header, type Go } from '../components/ui';
import { decodeBundle } from '../lib/share';

/** Friends coming across from your other copy of the app (Safari → Home Screen app on iPhone). */
export function MoveFriends({ go, data }: { go: Go; data: string }) {
  const [res, setRes] = useState<{ added: string[]; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    decodeBundle(data)
      .then(async (b) => {
        const { takeMovedFriends } = await import('../live/crewChannel');
        const added = takeMovedFriends(b);
        history.replaceState(null, '', location.pathname);
        window.dispatchEvent(new Event('gtg:friends'));
        setRes({ added, total: b.people.length });
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'That link looks broken or incomplete.'));
  }, [data]);

  return (
    <div className="screen">
      <Header title="Move friends" onBack={() => go({ name: 'home' })} />
      <div className="content">
        {err && <p className="error">{err}</p>}
        {!res && !err && <p className="muted">Bringing your friends across…</p>}
        {res && (
          <Card className="join-hero">
            <div className="eyebrow">
              <Users /> Friends moved
            </div>
            <h2>{res.added.length ? `${res.added.length} mate${res.added.length > 1 ? 's' : ''} added 🤝` : 'All sorted 🤝'}</h2>
            <p className="small">
              {res.added.length ? `${res.added.join(', ')} ${res.added.length > 1 ? 'are' : 'is'} on your Friends list now.` : `You already had all ${res.total} of them here.`} Invites you sent from Safari will land in this app from now on too.
            </p>
            <button className="btn primary block" onClick={() => go({ name: 'friends' })}>
              See my Friends
            </button>
          </Card>
        )}
      </div>
    </div>
  );
}
