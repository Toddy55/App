import { useState } from 'react';
import { Copy, Mail, MessageSquare, Share2, X } from 'lucide-react';
import { Card } from './ui';

/** How to put the app on a phone's home screen, added to every invite. */
const INSTALL_STEPS = [
  '📲 To make it an app on your phone:',
  '• iPhone: open the link in Safari, tap the Share button (square with the arrow), then "Add to Home Screen", then Add.',
  '• Android: open the link in Chrome, tap the ⋮ menu, then "Install app" (or "Add to Home screen").',
].join('\n');

function inviteMessage(intro: string, url: string) {
  return `${intro}\n${url}\n\n${INSTALL_STEPS}`;
}

/**
 * Send an invite by text, email, the phone's share sheet, or copy it.
 * The message always includes the install steps.
 */
export function InviteSheet({ title, intro, url, onClose }: { title: string; intro: string; url: string; onClose?: () => void }) {
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const text = inviteMessage(intro, url);
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

  const sms = () => {
    const nums = phone.split(/[,;]+/).map((n) => n.replace(/[^\d+]/g, '')).filter(Boolean);
    if (!nums.length) return;
    // iPhone and Android both accept sms:NUMBER?&body=… (several numbers comma-separated)
    location.href = `sms:${nums.join(',')}?&body=${encodeURIComponent(text)}`;
    setMsg(`Opening Messages for ${nums.join(', ')}…`);
  };
  const mail = () => {
    const to = email.split(/[,;\s]+/).filter((e) => e.includes('@'));
    if (!to.length) return;
    location.href = `mailto:${to.join(',')}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`;
    setMsg('Opening your email…');
  };
  const share = async () => {
    try {
      await (navigator as Navigator & { share: (d: ShareData) => Promise<void> }).share({ title, text });
    } catch {
      /* cancelled */
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg('Copied. Paste it in the group chat.');
    } catch {
      setMsg("Couldn't copy on this phone. Use Text or Email instead.");
    }
  };

  return (
    <Card className="invite-sheet">
      <div className="row between">
        <strong>{title}</strong>
        {onClose && (
          <button className="icon-btn small" onClick={onClose} aria-label="Close">
            <X />
          </button>
        )}
      </div>
      <label className="field">
        <span>Text it to a mobile (add a few with commas)</span>
        <div className="row gap">
          <input className="grow" type="tel" inputMode="tel" autoComplete="tel" placeholder="04xx xxx xxx" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <button className="btn" disabled={!phone.replace(/[^\d]/g, '')} onClick={sms}>
            <MessageSquare /> Text
          </button>
        </div>
      </label>
      <label className="field">
        <span>Or email it</span>
        <div className="row gap">
          <input className="grow" type="email" inputMode="email" autoComplete="email" placeholder="mate@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn" disabled={!email.includes('@')} onClick={mail}>
            <Mail /> Email
          </button>
        </div>
      </label>
      <div className="row gap wrap">
        {canShare && (
          <button className="btn primary" onClick={share}>
            <Share2 /> Share…
          </button>
        )}
        <button className="btn" onClick={copy}>
          <Copy /> Copy message
        </button>
      </div>
      {msg && <p className="ok small">{msg}</p>}
      <details className="invite-preview">
        <summary className="muted small">What they'll get</summary>
        <pre>{text.replace(url, url.length > 70 ? url.slice(0, 60) + '…' : url)}</pre>
      </details>
    </Card>
  );
}
