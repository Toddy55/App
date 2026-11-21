export type Accent = 'blue' | 'mint' | 'gold';
export type Mode = 'auto' | 'light' | 'dark';

const KEY = 'gtg.appearance';

export function readAppearance(): { accent: Accent; mode: Mode } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { accent: v.accent ?? 'blue', mode: v.mode ?? 'auto' };
  } catch {
    return { accent: 'blue', mode: 'auto' };
  }
}

/** Apply the colour choice to the page (purple + the chosen accent; light/dark/auto). */
export function applyAppearance(a = readAppearance()) {
  const root = document.documentElement;
  if (a.accent === 'blue') delete root.dataset.accent;
  else root.dataset.accent = a.accent;
  if (a.mode === 'auto') delete root.dataset.theme;
  else root.dataset.theme = a.mode;
  const dark = a.mode === 'dark' || (a.mode === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0e0c1e' : '#241a5e');
}

export function saveAppearance(a: { accent: Accent; mode: Mode }) {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* ignore */
  }
  applyAppearance(a);
}
