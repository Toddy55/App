import { useEffect, useRef, useState } from 'react';
import { Users } from 'lucide-react';
import { Card, Header, type Go } from '../components/ui';
import { decodeBundle } from '../lib/share';

/** Friends coming across from your other copy of the app (Safari → Home Screen app on iPhone). */
export function MoveFriends({ go, data }: { go: Go; data: string }) {
  const [res, setRes] = useState<{ added: string[]; total: number; rounds: number; comps: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    decodeBundle(data)
      .then(async (b) => {
        const { takeMovedFriends, takeMovedRounds } = await import('../live/crewChannel');
        const added = takeMovedFriends(b);
        const moved = takeMovedRounds(b);
        history.replaceState(null, '', location.pathname);
        window.dispatchEvent(new Event('gtg:friends'));
        setRes({ added, total: b.people.length, ...moved });
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'That link looks broken or incomplete.'));
  }, [data]);

  return (
    <div className="screen">
      <Header title="Move to the app" onBack={() => go({ name: 'home' })} />
      <div className="content">
        {err && <p className="error">{err}</p>}
        {!res && !err && <p className="muted">Bringing your friends and rounds across…</p>}
        {res && (
          <Card className="join-hero">
            <div className="eyebrow">
              <Users /> From Safari
            </div>
            <h2>All moved across 🤝</h2>
            <ul className="moved-list">
              <li>👥 {res.added.length ? `${res.added.length} mate${res.added.length > 1 ? 's' : ''} added: ${res.added.join(', ')}` : 'Friends: already all here'}</li>
              <li>⛳ {res.rounds ? `${res.rounds} round${res.rounds > 1 ? 's' : ''} with scores and shots` : 'Rounds: already all here'}</li>
              {res.comps > 0 && <li>🏆 {res.comps} comp{res.comps > 1 ? 's' : ''}</li>}
            </ul>
            <p className="small">From now on, just use this app on your Home Screen. Invites you sent from Safari will land here too. You can do this again any time: anything already here isn't doubled up.</p>
            <button className="btn primary block" onClick={() => go({ name: 'friends' })}>
              See my Friends
            </button>
          </Card>
        )}
      </div>
    </div>
  );
}
