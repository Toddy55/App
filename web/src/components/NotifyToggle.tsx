import { useState } from 'react';
import { Bell, BellRing } from 'lucide-react';
import { askNotify, notify, notifyState } from '../lib/notify';

/** One tap to let the app put mates' news on the lock screen. */
export function NotifyToggle({ label = 'Notify me when mates accept, join or go live' }: { label?: string }) {
  const [state, setState] = useState(notifyState);
  if (state === 'unsupported') return null;
  if (state === 'on')
    return (
      <p className="ok small notify-on">
        <BellRing /> Notifications are on. You'll get a ping when a mate accepts, joins your comp or tees off live.
      </p>
    );
  if (state === 'blocked')
    return <p className="muted small">🔕 Notifications are blocked for this app. Turn them on in your phone's Settings → Notifications, then come back.</p>;
  if (state === 'install-first')
    return <p className="muted small">🔔 On iPhone, notifications work once the app is on your Home Screen (Share → Add to Home Screen). Open it from there and turn them on.</p>;
  return (
    <button
      className="btn block"
      onClick={async () => {
        const s = await askNotify();
        setState(s);
        if (s === 'on') notify('🔔 Notifications on', "We'll let you know when your mates accept, join or go live.", { always: true, tag: 'hello' });
      }}
    >
      <Bell /> {label}
    </button>
  );
}
