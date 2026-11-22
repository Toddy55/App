import { useEffect, useRef, useState } from 'react';
import { store } from '../lib/storage';
import { liveAvailable } from '../live/config';
import { setLiveFriends } from '../live/liveFriends';
import { notify } from '../lib/notify';

/**
 * Runs the whole time the app is open, on every screen: when a mate opens
 * your friend link or joins one of your comps, they're added to your Friends
 * (and the comp) straight away, with a quick pop-up.
 */
export function MateWatcher({ go }: { go: (r: { name: 'friends' } | { name: 'live'; code: string }) => void }) {
  const [toast, setToast] = useState<string | null>(null);
  const liveTap = useRef<string | null>(null);
  const compKey = store
    .comps()
    .map((c) => c.id)
    .sort()
    .join(',');

  const announce = (names: string[]) => {
    if (!names.length) return;
    liveTap.current = null;
    setToast(`🤝 ${names.join(' and ')} linked up with you`);
    notify(`🤝 ${names.join(' and ')} accepted your invite`, `${names.length > 1 ? "They're" : 'They are'} on your Friends list now. Tap to say g'day.`, { hash: '#' + encodeURIComponent(JSON.stringify({ name: 'friends' })), tag: 'linkup' });
    window.dispatchEvent(new Event('gtg:friends'));
  };

  // Your friend links (on every crew code this person uses, e.g. Safari's too)
  const [crewCodes, setCrewCodes] = useState(() => readCrewCodes());
  useEffect(() => {
    const on = () => setCrewCodes(readCrewCodes());
    window.addEventListener('gtg:friends', on);
    return () => window.removeEventListener('gtg:friends', on);
  }, []);
  useEffect(() => {
    if (!liveAvailable()) return;
    let unsub: (() => void) | undefined;
    let stop = false;
    import('../live/crewChannel')
      .then(({ watchMyCrew }) => watchMyCrew((names) => (stop ? undefined : names.length ? announce(names) : window.dispatchEvent(new Event('gtg:friends')))))
      .then((u) => (stop ? u() : (unsub = u)))
      .catch(() => undefined);
    return () => {
      stop = true;
      unsub?.();
    };
  }, [crewCodes]);

  // Your name or handicap changed: tell your linked mates (their phones update you)
  useEffect(() => {
    if (!liveAvailable()) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        const me = store.settings().me;
        const sig = JSON.stringify([me.name, me.gaHandicap, me.gaNumber ?? '', me.hcpSource ?? '', store.friends().filter((f) => f.crew).length]);
        let last = '';
        try {
          last = localStorage.getItem('gtg.sharedMe') ?? '';
        } catch {
          /* fine */
        }
        if (sig === last) return;
        import('../live/crewChannel')
          .then(({ shareMyDetails }) => shareMyDetails())
          .then(() => {
            try {
              localStorage.setItem('gtg.sharedMe', sig);
            } catch {
              /* fine */
            }
          })
          .catch(() => undefined);
      }, 2500);
    };
    check();
    window.addEventListener('gtg:me', check);
    window.addEventListener('online', check);
    return () => {
      if (t) clearTimeout(t);
      window.removeEventListener('gtg:me', check);
      window.removeEventListener('online', check);
    };
  }, []);

  // Link-ups this phone couldn't send earlier (no signal): keep trying
  useEffect(() => {
    if (!liveAvailable()) return;
    const retry = () => import('../live/crewChannel').then(({ retryPendingLinkUps }) => retryPendingLinkUps()).catch(() => 0);
    retry();
    window.addEventListener('online', retry);
    const t = setInterval(retry, 60_000);
    return () => {
      window.removeEventListener('online', retry);
      clearInterval(t);
    };
  }, []);

  // Your comps: mates who join from an invite
  useEffect(() => {
    if (!liveAvailable() || !compKey) return;
    const unsubs: (() => void)[] = [];
    let stop = false;
    import('../live/compChannel')
      .then(async ({ watchJoiners, addJoiners }) => {
        for (const id of compKey.split(',')) {
          const c = store.comp(id);
          if (!c) continue;
          const before = new Set(store.friends().map((f) => f.name.toLowerCase()));
          const u = await watchJoiners(c, (joiners) => {
            const { added } = addJoiners(store.comp(id) ?? c, joiners);
            if (added.length) {
              const newMates = added.filter((n) => !before.has(n.toLowerCase()));
              newMates.forEach((n) => before.add(n.toLowerCase()));
              setToast(`🏆 ${added.join(' and ')} joined ${c.name}`);
              notify(`🏆 ${added.join(' and ')} joined ${c.name}`, 'Tap to see the comp table.', { hash: '#' + encodeURIComponent(JSON.stringify({ name: 'comp', id: c.id })), tag: 'comp-' + c.id });
              window.dispatchEvent(new Event('gtg:friends'));
            }
          });
          if (stop) u();
          else unsubs.push(u);
        }
      })
      .catch(() => undefined);
    return () => {
      stop = true;
      unsubs.forEach((u) => u());
    };
  }, [compKey]);

  // Friends playing live: listen on each friend's channel; pop up when someone tees off
  const [crewKey, setCrewKey] = useState(() => crewsKey());
  useEffect(() => {
    const on = () => setCrewKey(crewsKey());
    window.addEventListener('gtg:friends', on);
    return () => window.removeEventListener('gtg:friends', on);
  }, []);
  useEffect(() => {
    if (!liveAvailable() || !crewKey) return;
    let unsub: (() => void) | undefined;
    let stop = false;
    const seen = new Set<string>();
    let first = true;
    import('../live/crewChannel')
      .then(({ watchFriendsLive }) =>
        watchFriendsLive(crewKey.split(','), (live) => {
          if (stop) return;
          setLiveFriends(live);
          const fresh = live.filter((n) => !n.final && !seen.has(n.code));
          fresh.forEach((n) => seen.add(n.code));
          // Don't pop up for rounds already on when the app opened; Home shows those
          if (!first && fresh.length) setToast(`🔴 ${fresh.map((n) => n.name).join(' and ')} just went live at ${fresh[0].course}. Tap to watch`);
          if (!first && fresh.length) liveTap.current = fresh[0].code;
          if (!first && fresh.length) notify(`🔴 ${fresh.map((n) => n.name).join(' and ')} just went live`, `At ${fresh[0].course}. Tap to watch.`, { hash: '#live=' + fresh[0].code, tag: 'live-' + fresh[0].code });
          first = false;
        }),
      )
      .then((u) => (stop ? u() : (unsub = u)))
      .catch(() => undefined);
    return () => {
      stop = true;
      unsub?.();
    };
  }, [crewKey]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!toast) return null;
  return (
    <button
      className="mate-toast"
      onClick={() => {
        setToast(null);
        const code = liveTap.current;
        liveTap.current = null;
        if (code) go({ name: 'live', code });
        else go({ name: 'friends' });
      }}
    >
      {toast} ›
    </button>
  );
}

const crewsKey = () =>
  store
    .friends()
    .map((f) => f.crew)
    .filter((c): c is string => !!c)
    .sort()
    .join(',');

function readCrewCodes(): string {
  try {
    return [localStorage.getItem('gtg.crew') ?? '', localStorage.getItem('gtg.extraCrews') ?? ''].join('|');
  } catch {
    return '';
  }
}
