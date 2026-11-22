import { useEffect, useState } from 'react';
import { readHomeBg, resolveHomeBg } from '../lib/homeBg';

function useHomeBg() {
  const [id, setId] = useState(readHomeBg);
  useEffect(() => {
    const on = () => setId(readHomeBg());
    window.addEventListener('gtg:homebg', on);
    return () => window.removeEventListener('gtg:homebg', on);
  }, []);
  return resolveHomeBg(id);
}

/** The golf photo that sits behind the Home screen, fixed while the cards scroll over it. */
export function HomeBackdrop() {
  const bg = useHomeBg();
  if (!bg) return null;
  return <div className="home-bg" aria-hidden style={{ backgroundImage: `url("${bg.src}")`, backgroundPosition: bg.focus }} />;
}

/** Photographer and licence, as the free licences ask. */
export function HomeBgCredit() {
  const bg = useHomeBg();
  if (!bg?.credit) return null;
  return <p className="home-bg-credit">Photo: {bg.credit}</p>;
}
