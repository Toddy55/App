import { useEffect, useState } from 'react';
import { isIOS, isStandalone } from '../lib/install';
import { Card, ShotmateMark } from './ui';

const SEEN = 'gtg.rebrandSeen';

/**
 * We're Shotmate now. The app itself updates by itself, but iPhone keeps the
 * old name and icon on the Home Screen until the icon is added again, so walk
 * people through it without losing anything (the new icon links up by sync).
 */
export function RebrandNote() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(SEEN) === '1';
    } catch {
      return false;
    }
  });
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const show = !hidden && isIOS() && isStandalone();
  useEffect(() => {
    if (!show) return;
    import('../live/sync').then(({ turnOnSync, syncLink }) => turnOnSync().then(() => setLink(syncLink()))).catch(() => undefined);
  }, [show]);
  if (!show) return null;
  const done = () => {
    try {
      localStorage.setItem(SEEN, '1');
    } catch {
      /* fine */
    }
    setHidden(true);
  };
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      prompt('Copy this link:', link);
    }
    setCopied(true);
  };
  return (
    <Card className="rebrand">
      <div className="rebrand-head">
        <span className="rebrand-mark">
          <ShotmateMark size={30} />
        </span>
        <div>
          <strong>We're Shotmate now 🎉</strong>
          <div className="muted small">Same app, new name and icon. Everything you've got is still here.</div>
        </div>
      </div>
      <p className="small">iPhone keeps the old name and icon on your Home Screen until you add it again. Want the new one? It takes a minute and nothing gets lost:</p>
      <ol className="small steps">
        <li>
          Tap <strong>Copy my link</strong> below.
        </li>
        <li>
          In <strong>Safari</strong>, open <strong>{location.host + location.pathname}</strong> → <strong>Share</strong> → <strong>Add to Home Screen</strong> → <strong>Add</strong>.
        </li>
        <li>
          Open the new <strong>Shotmate</strong> icon → <strong>Friends</strong> → <strong>Paste an invite</strong>. All your rounds and mates come straight across.
        </li>
        <li>Then press and hold the old icon → Remove App.</li>
      </ol>
      <div className="row gap">
        <button className="btn primary grow" disabled={!link} onClick={copy}>
          {copied ? 'Copied ✓' : '🔗 Copy my link'}
        </button>
        <button className="btn grow" onClick={done}>
          Keep the old icon
        </button>
      </div>
    </Card>
  );
}
