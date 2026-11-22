import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Card, Header, type Go } from '../components/ui';
import { store } from '../lib/storage';

/** Opening a sync link: this copy of the app joins the other one's data, both ways. */
export function SyncJoin({ go, syncKey }: { go: Go; syncKey: string }) {
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');
  const [err, setErr] = useState('');
  const [counts, setCounts] = useState({ friends: 0, rounds: 0, comps: 0 });
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    import('../live/sync')
      .then(({ joinSync }) => joinSync(syncKey))
      .then(() => {
        history.replaceState(null, '', location.pathname);
        window.dispatchEvent(new Event('gtg:friends'));
        setCounts({ friends: store.friends().length, rounds: store.rounds().length, comps: store.comps().length });
        setState('done');
      })
      .catch((e) => {
        setErr(e instanceof Error ? e.message : String(e));
        setState('error');
      });
  }, [syncKey]);

  return (
    <div className="screen">
      <Header title="Linking up" onBack={() => go({ name: 'home' })} />
      <div className="content">
        {state === 'working' && <p className="muted">Linking this copy of the app and bringing everything across…</p>}
        {state === 'error' && <p className="error">{err || "Couldn't link up. Check your signal and try the link again."}</p>}
        {state === 'done' && (
          <Card className="join-hero">
            <div className="eyebrow">
              <RefreshCw /> Linked and syncing
            </div>
            <h2>All in step 🤝</h2>
            <ul className="moved-list">
              <li>👥 {counts.friends} friend{counts.friends === 1 ? '' : 's'}</li>
              <li>⛳ {counts.rounds} round{counts.rounds === 1 ? '' : 's'}, with scores and shots</li>
              {counts.comps > 0 && <li>🏆 {counts.comps} comp{counts.comps === 1 ? '' : 's'}</li>}
            </ul>
            <p className="small">From now on, anything you add or change here or in the other copy (Safari, the Home Screen app or another phone) shows up in both. Mates added twice have been merged into one.</p>
            <button className="btn primary block" onClick={() => go({ name: 'home' })}>
              Let's go
            </button>
          </Card>
        )}
      </div>
    </div>
  );
}
