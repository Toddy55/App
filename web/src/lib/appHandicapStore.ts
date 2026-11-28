import { appHandicap } from './appHandicap';
import { store } from './storage';

/**
 * Keep "from my rounds" handicaps up to date: yours and any mate's set that way.
 * Run at start-up and whenever a round finishes. Returns true if any changed.
 */
export function refreshAppHandicaps(): boolean {
  const rounds = store.rounds();
  const courses = store.courses();
  let changed = false;
  const s = store.settings();
  if (s.me.hcpSource === 'app') {
    const h = appHandicap(s.me.id, rounds, courses).index;
    if (h != null && h !== s.me.gaHandicap) {
      store.saveSettings({ ...s, me: { ...s.me, gaHandicap: h, hcpCheckedAt: Date.now() } });
      changed = true;
    }
  }
  for (const f of store.friends()) {
    if (f.hcpSource !== 'app') continue;
    const h = appHandicap(f.id, rounds, courses).index;
    if (h != null && h !== f.gaHandicap) {
      store.saveFriend({ ...f, gaHandicap: h, hcpCheckedAt: Date.now() });
      changed = true;
    }
  }
  return changed;
}
