import { useEffect, useRef, useState } from 'react';
import { Video } from 'lucide-react';
import type { ClipMeta } from '../live/clips';
import { liveAvailable } from '../live/config';
import { Card } from './ui';

/**
 * Shots filmed with the tracer sim during a live round, for everyone watching.
 * The newest one plays by itself as soon as it lands.
 */
export function ShotCam({ code, compact }: { code: string; compact?: boolean }) {
  const [clips, setClips] = useState<ClipMeta[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [fresh, setFresh] = useState(false);
  const newest = useRef<string | null>(null);

  useEffect(() => {
    if (!liveAvailable()) return;
    let unsub: (() => void) | undefined;
    let stop = false;
    import('../live/clips')
      .then(({ watchClips }) =>
        watchClips(code, (c) => {
          if (stop) return;
          setClips(c);
          const top = c[0] ? `${c[0].id}|${c[0].at}` : null;
          if (top && top !== newest.current) {
            // A new shot: jump to it (unless they're looking at an older one on purpose)
            if (newest.current !== null) setFresh(true);
            newest.current = top;
            setPick(null);
          }
        }),
      )
      .then((u) => (stop ? u() : (unsub = u)))
      .catch(() => undefined);
    return () => {
      stop = true;
      unsub?.();
    };
  }, [code]);

  const current = clips.find((c) => `${c.id}|${c.at}` === pick) ?? clips[0];
  const currentKey = current ? `${current.id}|${current.at}` : '';

  useEffect(() => {
    if (!current) return;
    let stop = false;
    setState('loading');
    import('../live/clips')
      .then(({ loadClip }) => loadClip(code, current))
      .then((u) => {
        if (stop) return;
        setSrc(u);
        setState('idle');
      })
      .catch(() => !stop && setState('error'));
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, currentKey]);

  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => setFresh(false), 2500);
    return () => clearTimeout(t);
  }, [fresh]);

  if (!clips.length || !current) return null;
  const ago = Math.max(0, Math.round((Date.now() - current.at) / 60000));

  return (
    <Card className={`shot-cam ${fresh ? 'flash' : ''} ${compact ? 'compact' : ''}`}>
      <div className="row between">
        <div className="eyebrow">
          <Video /> Shot cam{fresh ? ' · new shot!' : ''}
        </div>
        <span className="muted small">{ago < 1 ? 'just now' : `${ago} min ago`}</span>
      </div>
      <div className="shot-cam-stage">
        {src ? <video key={src} src={src} autoPlay muted loop playsInline controls /> : <div className="shot-cam-wait">{state === 'error' ? "Couldn't load this one" : 'Loading the shot…'}</div>}
      </div>
      <div className="shot-cam-cap">
        <strong>{current.name}</strong>
        {current.hole ? ` · hole ${current.hole}` : ''}
        {current.info.length ? ` · ${current.info.join(' · ')}` : ''}
      </div>
      {clips.length > 1 && !compact && (
        <div className="row gap wrap">
          {clips.map((c, i) => {
            const k = `${c.id}|${c.at}`;
            return (
              <button key={k} className={`chip ${k === currentKey ? 'on' : ''}`} onClick={() => setPick(k)}>
                {i === 0 ? 'Latest' : `${c.name.split(' ')[0]}${c.club ? ` ${c.club}` : ''}`}
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}
