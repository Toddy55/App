export type Palette = 'midnight' | 'purple' | 'augusta' | 'plum' | 'carbon' | 'ocean' | 'lavender';
export type Mode = 'auto' | 'light' | 'dark';

export const PALETTES: { id: Palette; label: string; brand: string; accent: string; deep: string }[] = [
  { id: 'midnight', label: 'Navy & lime', brand: '#13315c', accent: '#c6f432', deep: '#08162e' },
  { id: 'purple', label: 'Purple & blue', brand: '#4a2bb3', accent: '#2bc4ff', deep: '#241a5e' },
  { id: 'augusta', label: 'Green & gold', brand: '#0f5a3f', accent: '#e9b949', deep: '#06291c' },
  { id: 'plum', label: 'Plum & peach', brand: '#6a2361', accent: '#ff9f7a', deep: '#2e0f2a' },
  { id: 'carbon', label: 'Black & orange', brand: '#2c2c30', accent: '#ff7a1a', deep: '#111113' },
  { id: 'ocean', label: 'Ocean & sunshine', brand: '#0a5c8c', accent: '#ffd23f', deep: '#032a45' },
  { id: 'lavender', label: 'Lavender & teal', brand: '#6b4fd8', accent: '#14d1b8', deep: '#4330a8' },
];

const KEY = 'gtg.appearance';

export function readAppearance(): { palette: Palette; mode: Mode } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const palette = PALETTES.some((p) => p.id === v.palette) ? v.palette : 'midnight';
    return { palette, mode: v.mode ?? 'auto' };
  } catch {
    return { palette: 'midnight', mode: 'auto' };
  }
}

/** Apply the colour scheme and light/dark choice to the page. */
export function applyAppearance(a = readAppearance()) {
  const root = document.documentElement;
  if (a.palette === 'midnight') delete root.dataset.palette;
  else root.dataset.palette = a.palette;
  // The app always wears its deep brand colours now (no white screens or boxes)
  root.dataset.theme = 'dark';
  const p = PALETTES.find((x) => x.id === a.palette)!;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.deep);
}

export function saveAppearance(a: { palette: Palette; mode: Mode }) {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* ignore */
  }
  applyAppearance(a);
}
