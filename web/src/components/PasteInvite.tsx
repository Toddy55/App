import { useState } from 'react';
import { inviteHash } from '../lib/install';
import { Card } from './ui';

/** Open an invite link inside the installed app (links open in Safari on iPhone). */
export function PasteInvite() {
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const open = (t: string) => {
    const h = inviteHash(t);
    if (!h) return setErr("That doesn't look like a Fairway Coach invite. Copy the whole link from the message.");
    setErr(null);
    location.hash = h;
  };
  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      setText(t);
      open(t);
    } catch {
      setErr('Tap in the box, then Paste.');
    }
  };
  return (
    <Card title="Got an invite?">
      <div className="row gap">
        <input className="grow" placeholder="Paste the invite link" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn" onClick={() => (text.trim() ? open(text) : paste())}>
          {text.trim() ? 'Open' : 'Paste an invite'}
        </button>
      </div>
      {err && <p className="error small">{err}</p>}
      <p className="muted small">For comp invites, friend links and live rounds a mate sent you.</p>
    </Card>
  );
}
