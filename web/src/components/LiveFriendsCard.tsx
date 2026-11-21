import { Radio } from 'lucide-react';
import { useLiveFriends } from '../live/liveFriends';
import type { Go } from './ui';

/** Mates playing live right now: tap to watch their card (and shot cam). No link needed. */
export function LiveFriendsCard({ go }: { go: Go }) {
  const live = useLiveFriends();
  if (!live.length) return null;
  return (
    <div className="live-friends">
      {live.map((n) => {
        const mins = Math.max(0, Math.round((Date.now() - n.at) / 60000));
        return (
          <button key={n.code} className="live-friend" onClick={() => go({ name: 'live', code: n.code })}>
            <span className="live-dot synced" />
            <span className="grow">
              <strong>
                {n.name} is live at {n.course}
              </strong>
              <span className="muted small">
                {n.headline ? `${n.headline} · ` : ''}on hole {n.hole} · {mins < 1 ? 'just now' : `${mins} min ago`}
              </span>
            </span>
            <span className="watch">
              <Radio /> Watch
            </span>
          </button>
        );
      })}
    </div>
  );
}
