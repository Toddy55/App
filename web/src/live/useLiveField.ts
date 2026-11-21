import { useEffect, useMemo, useState } from 'react';
import type { Round } from '../types';
import { decodeBundle, makeBundle, type Bundle } from '../lib/share';
import { mergeEventBundles } from '../lib/merge';
import { store } from '../lib/storage';
import { liveAvailable } from './config';

/**
 * While you're scoring a live round, keep an eye on the other groups in the
 * same event so your own scorecard can show their teams too. Your own group
 * always comes from this phone (it's newer than what's on the server).
 */
export function useLiveField(round: Round | undefined): { field: Round | null; bundle: Bundle | null; groups: number } {
  const code = round?.liveCode;
  const others = useEventGroups(code);

  const bundle = useMemo(() => {
    if (!round || !code) return null;
    const theirs = others.filter((g) => g.id !== round.liveGroup && g.bundle.rounds[0]);
    if (!theirs.length) return null;
    const settings = store.settings();
    const mine = makeBundle({ me: settings.me, friends: store.friends(), rounds: [round], comps: [] });
    try {
      return mergeEventBundles([mine, ...theirs.map((g) => g.bundle)], code);
    } catch {
      return null;
    }
  }, [round, code, others]);
  const field = bundle?.rounds[0] ?? null;

  return { field, bundle, groups: field ? others.filter((g) => g.id !== round?.liveGroup).length + 1 : 1 };
}

/** Every group's latest card in a live event (empty until it connects). */
export function useEventGroups(code: string | undefined): { id: string; bundle: Bundle }[] {
  const [others, setOthers] = useState<{ id: string; bundle: Bundle }[]>([]);
  useEffect(() => {
    setOthers([]);
    if (!code || !liveAvailable()) return;
    let unsub: (() => void) | undefined;
    let cancelled = false;
    import('./live')
      .then(({ watchEvent }) =>
        watchEvent(
          code,
          async (docs) => {
            if (!docs) return setOthers([]);
            try {
              const list = await Promise.all(
                Object.entries(docs).map(async ([id, doc]) => ({ id, bundle: await decodeBundle(doc.data) })),
              );
              if (!cancelled) setOthers(list);
            } catch {
              /* a half-written card; the next update will fix it */
            }
          },
          () => undefined,
        ),
      )
      .then((u) => {
        if (cancelled) u();
        else unsub = u;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [code]);

  return others;
}
