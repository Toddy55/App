import { useState } from 'react';
import { isIOS, isStandalone } from '../lib/install';
import { Card } from './ui';

/**
 * On an iPhone, the Home Screen app has its own storage, separate from
 * Safari, so anything joined in Safari doesn't carry over. Walk them through
 * installing first, then pasting the invite into the installed app.
 */
export function InstallFirst({ after, link }: { after?: boolean; link?: string } = {}) {
  const [copied, setCopied] = useState(false);
  if (!isIOS() || isStandalone()) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link ?? location.href);
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
          Open <strong>Fairway Coach</strong> from your Home Screen and tap <strong>Paste an invite</strong>.
        </li>
      </ol>
      <button className="btn primary block" onClick={copy}>
        {copied ? '✅ Copied' : 'Copy this invite'}
      </button>
      <p className="muted small">
        {after
          ? "Your mates already have you. iPhone keeps the Home Screen app separate from Safari, so pasting the invite once there links that copy too."
          : "iPhone keeps the Home Screen app separate from Safari, so joining here in Safari won't show up in the app. Just using Safari? Carry on below."}
      </p>
    </Card>
  );
}
