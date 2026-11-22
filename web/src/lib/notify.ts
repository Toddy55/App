/**
 * Phone notifications (the kind that show on the lock screen) for things a
 * mate does: accepting your invite, joining your comp, teeing off live.
 *
 * Works while the app is open or sitting in the background. On iPhone it needs
 * the app added to the Home Screen first (Apple's rule).
 */
export type NotifyState = 'on' | 'off' | 'blocked' | 'unsupported' | 'install-first';

const isIphone = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const installed = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export function notifyState(): NotifyState {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return isIphone() && !installed() ? 'install-first' : 'unsupported';
  if (Notification.permission === 'granted') return 'on';
  if (Notification.permission === 'denied') return 'blocked';
  return 'off';
}

/** Ask the phone for permission (must come from a tap). */
export async function askNotify(): Promise<NotifyState> {
  if (notifyState() === 'off') {
    try {
      await Notification.requestPermission();
    } catch {
      /* older Safari */
    }
  }
  return notifyState();
}

/**
 * Show a notification. Skipped while you're looking at the app (the pop-up
 * inside the app covers that), unless `always` is set.
 */
export async function notify(title: string, body: string, opts: { hash?: string; tag?: string; always?: boolean } = {}) {
  if (notifyState() !== 'on') return;
  if (!opts.always && document.visibilityState === 'visible') return;
  const icon = `${import.meta.env.BASE_URL}icon-192.png`;
  const url = `${location.origin}${location.pathname}${opts.hash ?? ''}`;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await reg.showNotification(title, { body, icon, badge: icon, tag: opts.tag, data: { url } });
    else new Notification(title, { body, icon, tag: opts.tag });
  } catch {
    /* not allowed here; the in-app pop-up still shows */
  }
}
