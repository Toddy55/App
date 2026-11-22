/** Running as the installed (Home Screen) app rather than in the browser. */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || !!window.matchMedia?.('(display-mode: standalone)').matches;
}

export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Pull an app link (comp invite, friend link, shared round, live round) out of pasted text. */
export function inviteHash(text: string): string | null {
  const m = text.match(/#(join|friend|import|live|move)=([A-Za-z0-9_\-]+)(&to=[^\s&#]+)?/);
  return m ? `#${m[1]}=${m[2]}${m[3] ?? ''}` : null;
}
