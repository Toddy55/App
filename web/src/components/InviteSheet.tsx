import { useState } from 'react';
import { BookUser, Copy, Mail, MessageSquare, Share2, X } from 'lucide-react';
import { Card } from './ui';

/** The Contact Picker API (Chrome on Android); not in TypeScript's DOM types yet. */
interface PickedContact {
  name?: string[];
  tel?: string[];
  email?: string[];
}
interface ContactsManager {
  select(props: ('name' | 'tel' | 'email')[], opts?: { multiple?: boolean }): Promise<PickedContact[]>;
}

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
  const [picked, setPicked] = useState<{ name: string; tel?: string; email?: string }[]>([]);
  const text = inviteMessage(intro, url);
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;
  // Android (Chrome) can open the phone's contacts and let you tick several; iPhone can't (yet)
  const contacts = (navigator as Navigator & { contacts?: ContactsManager }).contacts;
  const canPick = !!contacts && 'ContactsManager' in window;
  const isIphone = /iPhone|iPad|iPod/.test(navigator.userAgent);

  const pick = async () => {
    try {
      const got = await contacts!.select(['name', 'tel', 'email'], { multiple: true });
      const add = got
        .map((c) => ({ name: c.name?.[0] ?? c.tel?.[0] ?? c.email?.[0] ?? 'Mate', tel: c.tel?.[0], email: c.email?.[0] }))
        .filter((c) => c.tel || c.email);
      setPicked((prev) => [...prev, ...add.filter((a) => !prev.some((p) => p.tel === a.tel && p.email === a.email))]);
    } catch {
      /* cancelled */
    }
  };

  const typedNums = phone.split(/[,;]+/).map((n) => n.replace(/[^\d+]/g, '')).filter(Boolean);
  const nums = [...picked.map((p) => p.tel?.replace(/[^\d+]/g, '')).filter((n): n is string => !!n), ...typedNums];
  const typedEmails = email.split(/[,;\s]+/).filter((e) => e.includes('@'));
  const emails = [...picked.map((p) => p.email).filter((e): e is string => !!e && !picked.find((x) => x.email === e)?.tel), ...typedEmails];

  const sms = () => {
    // iPhone and Android both accept sms:NUMBER,NUMBER?&body=… With no number, Messages
    // opens with the message ready and you add people from your contacts there.
    location.href = `sms:${nums.join(',')}?&body=${encodeURIComponent(text)}`;
    setMsg(nums.length ? `Opening Messages for ${nums.length} ${nums.length === 1 ? 'mate' : 'mates'}…` : 'Opening Messages: add your mates from your contacts.');
  };
  const mail = () => {
    const to = emails;
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
      {canPick && (
        <button className="btn block" onClick={pick}>
          <BookUser /> Choose from my contacts
        </button>
      )}
      {picked.length > 0 && (
        <div className="row gap wrap">
          {picked.map((p, i) => (
            <span key={i} className="chip on picked">
              {p.name}
              <button aria-label={`Remove ${p.name}`} onClick={() => setPicked(picked.filter((_, j) => j !== i))}>
                <X />
              </button>
            </span>
          ))}
        </div>
      )}
      <label className="field">
        <span>{canPick ? 'Or type mobile numbers (commas between)' : 'Text it: type mobile numbers (commas between)'}</span>
        <div className="row gap">
          <input className="grow" type="tel" inputMode="tel" autoComplete="tel" placeholder="04xx xxx xxx" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <button className="btn" onClick={sms}>
            <MessageSquare /> Text{nums.length > 1 ? ` ${nums.length}` : ''}
          </button>
        </div>
      </label>
      {!canPick && (
        <p className="muted small">
          {isIphone ? 'Easiest on iPhone: ' : 'Or '}leave the number empty and tap <strong>Text</strong>. Messages opens with the invite ready, and you tap <strong>+</strong> to add as many mates from your contacts as you like.
        </p>
      )}
      <label className="field">
        <span>Or email it</span>
        <div className="row gap">
          <input className="grow" type="email" inputMode="email" autoComplete="email" placeholder="mate@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn" disabled={!emails.length} onClick={mail}>
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
