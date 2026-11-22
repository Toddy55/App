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
          <button key={n.code} className={`live-friend ${n.final ? 'done' : ''}`} onClick={() => go({ name: 'live', code: n.code })}>
            {n.final ? <span className="done-dot">✓</span> : <span className="live-dot synced" />}
            <span className="grow">
              <strong>{n.final ? `${n.name} finished at ${n.course}` : `${n.name} is live at ${n.course}`}</strong>
              <span className="muted small">
                {n.headline ? `${n.headline} · ` : ''}
                {n.final ? (mins < 60 ? `${Math.max(1, mins)} min ago` : `${Math.round(mins / 60)} h ago`) : `on hole ${n.hole} · ${mins < 1 ? 'just now' : `${mins} min ago`}`}
              </span>
            </span>
            <span className="watch">{n.final ? '▶ Replay' : (<><Radio /> Watch</>)}</span>
          </button>
        );
      })}
    </div>
  );
}
