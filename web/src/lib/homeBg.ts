/** Photo behind the Home screen. Free-licence shots from Wikimedia Commons, or your own. */
export interface HomeBg {
  id: string;
  label: string;
  /** File under public/bg. */
  file: string;
  /** Which part of the photo to keep when a tall phone crops it (CSS background-position). */
  focus: string;
  credit: string;
}

export const HOME_BGS: HomeBg[] = [
  { id: 'barnbougle', label: 'Barnbougle Dunes, Tas', file: 'barnbougle.jpg', focus: '35% 60%', credit: 'Barnbougle Dunes · Johnorchard, CC BY-SA 4.0' },
  { id: 'pebble', label: 'Pebble Beach 18th', file: 'pebble.jpg', focus: '40% 50%', credit: 'Pebble Beach · WilliamFMeyer, CC BY-SA 4.0' },
  { id: 'standrews', label: 'Old Course, St Andrews', file: 'standrews.jpg', focus: '55% 50%', credit: 'The Old Course · Neil Theasby, CC BY-SA 2.0' },
  { id: 'ballybunion', label: 'Ballybunion, Ireland', file: 'ballybunion.jpg', focus: '50% 50%', credit: 'Ballybunion · Bernard Gagnon, CC BY-SA 4.0' },
  { id: 'canberra', label: 'Royal Canberra green', file: 'canberra.jpg', focus: '50% 50%', credit: 'Royal Canberra · Neuroxic, CC BY 4.0' },
];

export const DEFAULT_BG = 'barnbougle';
const KEY = 'gtg.homeBg';
const OWN = 'gtg.homeBgOwn';

/** Chosen background id: one of HOME_BGS, 'own', or 'none'. */
export function readHomeBg(): string {
  try {
    return localStorage.getItem(KEY) || DEFAULT_BG;
  } catch {
    return DEFAULT_BG;
  }
}

export function saveHomeBg(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* private mode: stays as is */
  }
  window.dispatchEvent(new Event('gtg:homebg'));
}

export function readOwnBg(): string | null {
  try {
    return localStorage.getItem(OWN);
  } catch {
    return null;
  }
}

/** Shrink a photo from the camera roll so it fits in the phone's storage, then save it. */
export async function saveOwnBg(file: File): Promise<void> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => bad(new Error("Couldn't open that photo."));
      i.src = url;
    });
    const max = 1600;
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    let q = 0.8;
    let data = c.toDataURL('image/jpeg', q);
    while (data.length > 1_400_000 && q > 0.4) data = c.toDataURL('image/jpeg', (q -= 0.1));
    try {
      localStorage.setItem(OWN, data);
    } catch {
      throw new Error('Not enough room on this phone for that photo. Try a smaller one.');
    }
    saveHomeBg('own');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** What to paint for an id: image URL, crop focus and credit (null for none). */
export function resolveHomeBg(id: string): { src: string; focus: string; credit?: string } | null {
  if (id === 'none') return null;
  if (id === 'own') {
    const own = readOwnBg();
    return own ? { src: own, focus: '50% 50%' } : null;
  }
  const bg = HOME_BGS.find((b) => b.id === id) ?? HOME_BGS[0];
  return { src: `${import.meta.env.BASE_URL}bg/${bg.file}`, focus: bg.focus, credit: bg.credit };
}
