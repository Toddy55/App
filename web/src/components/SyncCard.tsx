import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { liveAvailable } from '../live/config';
import { Card } from './ui';

/** Settings: your data backed up and shared across your copies of the app (Safari, Home Screen app, other phones). */
export function SyncCard() {
  const [link, setLink] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!liveAvailable()) return;
    let stop = false;
    import('../live/sync')
      .then(async ({ turnOnSync, syncLink, lastSyncedAt }) => {
        await turnOnSync();
        if (stop) return;
        setLink(syncLink());
        setAt(lastSyncedAt());
      })
      .catch(() => setMsg("Couldn't reach the server just now. It'll keep trying."));
    const t = setInterval(() => import('../live/sync').then(({ lastSyncedAt }) => setAt(lastSyncedAt())), 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);
  if (!liveAvailable()) return null;
  const share = async () => {
    if (!link) return;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    try {
      if (nav.share) await nav.share({ title: 'Shotmate sync', text: 'Open this on my other phone (or the Home Screen app) to link it:', url: link });
      else {
        await navigator.clipboard.writeText(link);
        setMsg('Link copied. Paste it in the other copy: Friends → Paste an invite.');
      }
    } catch {
      /* cancelled */
    }
  };
  const ago = at ? Math.round((Date.now() - at) / 60000) : null;
  return (
    <Card title="Sync & backup">
      <p className="small">
        <RefreshCw className="inline-ico" /> Your rounds, friends, comps and settings are backed up and kept in step across every copy of the app you link: Safari and the Home Screen app, a new phone, an iPad.
      </p>
      <p className="ok small">{at ? `✓ Synced ${ago! < 1 ? 'just now' : `${ago} min ago`}` : 'Syncing…'}</p>
      <button className="btn primary block" disabled={!link} onClick={share}>
        🔗 Link another phone or copy
      </button>
      <p className="muted small">On the other one, open the link (or paste it under Friends → Paste an invite). This link opens all your data, so only send it to yourself.</p>
      {msg && <p className="small">{msg}</p>}
    </Card>
  );
}
