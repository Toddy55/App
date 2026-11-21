import { useEffect, useRef, useState } from 'react';
import type { Round } from '../types';
import { liveAvailable } from './config';
import { livePayload, liveUrl, newEventCode, newGroupId } from './payload';
import { shareLink } from '../lib/share';
import { Card, type Go } from '../components/ui';

/**
 * Scorer's control on the hole screen: go live, share the link, and keep the
 * watchers up to date on every score change. Each group's scorer pushes only
 * their own card; the watchers' screens merge the groups.
 */
export function LiveControl({ round, hole, onLive, go }: { round: Round; hole: number; onLive: (code: string, group: string) => void; go: Go }) {
  const [state, setState] = useState<'idle' | 'synced' | 'pending' | 'error'>(round.liveCode ? 'pending' : 'idle');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, tick] = useState(0);

  // Push every change (debounced so quick taps on +/− send one update)
  useEffect(() => {
    if (!round.liveCode || !round.liveGroup) return;
    const code = round.liveCode;
    const group = round.liveGroup;
    setState('pending');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const [{ pushGroup }, payload] = await Promise.all([import('./live'), livePayload(round, hole)]);
        await pushGroup(code, group, payload);
        setState('synced');
        setSyncedAt(Date.now());
        setErr(null);
      } catch (e) {
        setState('error');
        setErr(e instanceof Error ? e.message : String(e));
      }
    }, 600);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [round, hole]);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  if (!liveAvailable()) return null;

  const share = async (code: string) => {
    try {
      const how = await shareLink(
        'Live scores',
        `Follow us live at ${round.courseName} (code ${code}). Playing in another group or team? Open this and tap "Join with my group or team":`,
        liveUrl(code),
      );
      setMsg(how === 'copied' ? 'Link copied. Paste it in the group chat.' : null);
    } catch {
      setMsg(`Code: ${code}`);
    }
  };

  if (!round.liveCode) {
    return (
      <Card className="live-card">
        <div className="row between">
          <div>
            <strong>📡 Live scoring</strong>
            <div className="muted small">Your mates watch the scores update as you enter them. Playing another group or team? Send them the link and both cards join up.</div>
          </div>
          <button
            className="btn primary small"
            onClick={() => {
              const code = newEventCode();
              onLive(code, newGroupId());
              share(code);
            }}
          >
            Go live
          </button>
        </div>
      </Card>
    );
  }

  const ago = syncedAt ? Math.round((Date.now() - syncedAt) / 1000) : null;
  return (
    <Card className="live-card on">
      <div className="row between">
        <div>
          <strong>
            <span className={`live-dot ${state}`} /> LIVE · {round.liveCode}
          </strong>
          <div className="muted small">
            {state === 'synced' && ago != null
              ? `Your group's card is up to date${ago > 4 ? ` (${ago}s ago)` : ''}`
              : state === 'error'
                ? `Not sent: ${err ?? 'error'}`
                : "Sending… (no signal? it'll send when you're back in range)"}
          </div>
        </div>
        <div className="row gap">
          <button className="btn small ghost" onClick={() => go({ name: 'live', code: round.liveCode! })}>
            Field
          </button>
          <button className="btn small" onClick={() => share(round.liveCode!)}>
            Share
          </button>
        </div>
      </div>
      {msg && <p className="ok small">{msg}</p>}
    </Card>
  );
}

/** Send the final card straight away (used when the round is finished). */
export async function pushFinal(round: Round, hole: number) {
  if (!round.liveCode || !round.liveGroup || !liveAvailable()) return;
  try {
    const [{ pushGroup }, payload] = await Promise.all([import('./live'), livePayload(round, hole)]);
    await pushGroup(round.liveCode, round.liveGroup, payload);
  } catch {
    /* the next edit will retry */
  }
}
