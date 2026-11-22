import { useEffect, useState } from 'react';
import { isIOS, isStandalone } from '../lib/install';
import { Card } from './ui';

/**
 * On an iPhone, the Home Screen app has its own storage, separate from
 * Safari, so anything joined in Safari doesn't carry over. Walk them through
 * installing first, then pasting the invite into the installed app.
 */
export function InstallFirst({ after, link }: { after?: boolean; link?: string } = {}) {
  const [copied, setCopied] = useState(false);
  // After joining in Safari: hand the app this copy's sync link, so it gets everything joined here (and stays in step)
  const [sync, setSync] = useState<string | null>(null);
  useEffect(() => {
    if (!after || !isIOS() || isStandalone()) return;
    import('../live/sync').then(({ turnOnSync, syncLink }) => turnOnSync().then(() => setSync(syncLink()))).catch(() => undefined);
  }, [after]);
  if (!isIOS() || isStandalone()) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(after && sync ? sync : (link ?? location.href));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Card className="install-first">
      <strong>{after ? '📲 Get the app on your Home Screen:' : '📲 On iPhone? Do this first so nothing gets lost:'}</strong>
      <ol className="small">
        <li>
          Tap <strong>Copy this invite</strong> below.
        </li>
        <li>
          Tap Safari's <strong>Share</strong> button (square with the arrow) → <strong>Add to Home Screen</strong> → <strong>Add</strong>.
        </li>
        <li>
          Open <strong>Shotmate</strong> from your Home Screen and tap <strong>Paste an invite</strong>.
        </li>
      </ol>
      <button className="btn primary block" onClick={copy}>
        {copied ? '✅ Copied' : 'Copy this invite'}
      </button>
      <p className="muted small">
        {after
          ? "Your mates already have you. iPhone keeps the Home Screen app separate from Safari: pasting this once there links the two, so everything you do in either shows up in both."
          : "iPhone keeps the Home Screen app separate from Safari, so joining here in Safari won't show up in the app. Just using Safari? Carry on below."}
      </p>
    </Card>
  );
}
