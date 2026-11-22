import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react';
import type { LatLon, Round } from '../types';
import { bearingDeg, fmtDist } from '../lib/geo';
import { ESRI, QLD_AERIAL, makeFrame, project, tileLayout } from '../lib/holeFrame';
import { inQueensland } from '../lib/greenDem';
import { shotLegs } from '../lib/tracer';

const LEG_S = 1.2;
const GAP_S = 0.35;

/**
 * Full-screen, TV-style replay: the hole turned so you're looking down it,
 * each shot flying in after the last, club and distance where it landed.
 * "Play round" runs through every tracked hole.
 */
/** Opens over everything (cards make their own layers, which would trap it). */
export function RoundReplay(props: { round: Round; units: 'm' | 'yd'; who?: string; onClose: () => void; startHole?: number }) {
  return createPortal(<ReplayInner {...props} />, document.body);
}

function ReplayInner({ round, units, who, onClose, startHole }: { round: Round; units: 'm' | 'yd'; who?: string; onClose: () => void; startHole?: number }) {
  const tracked = useMemo(() => round.holes.filter((h) => (round.shots?.[h.number]?.length ?? 0) > 0), [round]);
  const [i, setI] = useState(() => Math.max(0, tracked.findIndex((h) => h.number === startHole)));
  const [run, setRun] = useState(0);
  const [auto, setAuto] = useState(false);
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    document.body.classList.add('replay-open');
    return () => {
      window.removeEventListener('resize', on);
      document.body.classList.remove('replay-open');
    };
  }, []);

  const hole = tracked[i];
  const shots = useMemo(() => (hole ? round.shots[hole.number] ?? [] : []), [hole, round]);
  const flag: LatLon | undefined = hole ? round.pins?.[hole.number] ?? hole.green?.centre : undefined;
  const legs = useMemo(() => shotLegs(shots, flag), [shots, flag]);
  const total = legs.length * (LEG_S + GAP_S);

  // Playing the whole round: move on once this hole's shots have landed
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => {
      if (i < tracked.length - 1) {
        setI(i + 1);
        setRun((n) => n + 1);
      } else setAuto(false);
    }, (total + 1.8) * 1000);
    return () => clearTimeout(t);
  }, [auto, i, run, total, tracked.length]);

  const view = useMemo(() => {
    if (!hole || !shots.length) return null;
    const origin = hole.tee ?? shots[0];
    const end = hole.green?.centre ?? flag ?? shots[shots.length - 1];
    const upDeg = bearingDeg(origin, end);
    const pad = { top: 96, right: 24, bottom: 170, left: 24 };
    const frame = makeFrame({ origin, upDeg, fit: [origin, end, ...shots, ...(flag ? [flag] : [])], width: size.w, height: size.h, pad, minSpanM: 80 });
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const qld = inQueensland(origin);
    const base = tileLayout(frame, size.w, size.h, dpr, ESRI, 18);
    const top = qld ? tileLayout(frame, size.w, size.h, dpr, QLD_AERIAL) : null;
    return { frame, base, top };
  }, [hole, shots, flag, size]);

  if (!hole || !view) {
    return (
      <div className="replay">
        <button className="replay-close" onClick={onClose} aria-label="Close">
          <X />
        </button>
        <p className="replay-empty">No shots tracked in this round yet. Mark shots during the round (or with "Hey Siri, mark shot") and they'll replay here.</p>
      </div>
    );
  }

  const P = (p: LatLon) => project(view.frame, p);
  const gross = round.scores[round.meId]?.[hole.number];
  const go = (n: number) => {
    setI(Math.max(0, Math.min(tracked.length - 1, n)));
    setRun((r) => r + 1);
  };

  return (
    <div className="replay">
      <svg key={`${hole.number}-${run}`} className="replay-map" width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`}>
        {[view.base, view.top].map((t) =>
          t ? (
            <g key={t.tiles[0]?.key.split('/')[0] ?? 'x'} transform={t.matrix}>
              {t.tiles.map((tile) => (
                <image key={tile.key} href={tile.href} x={tile.x} y={tile.y} width={256} height={256} preserveAspectRatio="none" />
              ))}
            </g>
          ) : null,
        )}
        <rect width={size.w} height={size.h} className="replay-shade" />
        {hole.green?.polygon && <polygon points={hole.green.polygon.map((q) => `${P(q).x},${P(q).y}`).join(' ')} className="replay-green" />}
        {flag && (
          <g transform={`translate(${P(flag).x},${P(flag).y})`} className="replay-flag">
            <line x1={0} y1={0} x2={0} y2={-26} />
            <path d="M0,-26 L16,-21 L0,-16 Z" />
            <circle r={3} />
          </g>
        )}
        {legs.map((l, k) => {
          const a = P(l.from);
          const b = P(l.to);
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          // A gentle arc so it reads as a ball in the air, like the TV tracers
          const bend = /putt/i.test(l.club ?? '') ? 0 : Math.min(60, len * 0.16);
          const c = { x: (a.x + b.x) / 2 + ((b.y - a.y) / (len || 1)) * bend * 0.35, y: (a.y + b.y) / 2 - ((b.x - a.x) / (len || 1)) * bend * 0.35 - bend * 0.25 };
          const d = `M${a.x},${a.y} Q${c.x},${c.y} ${b.x},${b.y}`;
          const delay = k * (LEG_S + GAP_S);
          const style = { animationDelay: `${delay}s`, animationDuration: `${LEG_S}s` };
          return (
            <g key={k}>
              <path d={d} className="replay-trail" pathLength={1} style={style} />
              <path d={d} className="replay-line" pathLength={1} style={style} />
              <circle r={5} className="replay-ball">
                <animateMotion path={d} begin={`${delay}s`} dur={`${LEG_S}s`} fill="freeze" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.2 0.6 0.4 1" />
              </circle>
              <g className="replay-tag" style={{ animationDelay: `${delay + LEG_S * 0.8}s` }} transform={`translate(${b.x},${b.y})`}>
                <circle r={4} className="replay-land" />
                <g transform={`translate(${b.x > size.w - 120 ? -10 : 10},-10)`}>
                  <rect x={b.x > size.w - 120 ? -96 : 0} y={-14} width={96} height={24} rx={12} />
                  <text x={b.x > size.w - 120 ? -48 : 48} y={3}>
                    {(l.club ?? `Shot ${k + 1}`).slice(0, 8)} · {fmtDist(l.distance, units)}
                    {units}
                  </text>
                </g>
              </g>
            </g>
          );
        })}
        {legs[0] && <circle cx={P(legs[0].from).x} cy={P(legs[0].from).y} r={6} className="replay-tee" />}
      </svg>

      <div className="replay-head">
        <div className="replay-hole">{hole.number}</div>
        <div className="grow">
          <strong>
            Par {hole.par}
            {hole.lengthM ? ` · ${fmtDist(hole.lengthM, units)}${units}` : ''}
          </strong>
          <div className="small">
            {who ? `${who} · ` : ''}
            {shots.length} shot{shots.length === 1 ? '' : 's'} tracked{gross != null ? ` · made ${gross}` : ''}
          </div>
        </div>
        <button className="replay-close" onClick={onClose} aria-label="Close">
          <X />
        </button>
      </div>

      <div className="replay-foot">
        <div className="replay-controls">
          <button className="replay-btn" disabled={i === 0} onClick={() => go(i - 1)} aria-label="Previous hole">
            <ChevronLeft />
          </button>
          <button className="replay-btn wide" onClick={() => (auto ? setAuto(false) : (setAuto(true), setRun((r) => r + 1)))}>
            {auto ? <Pause /> : <Play />} {auto ? 'Pause' : tracked.length > 1 ? 'Play the round' : 'Replay'}
          </button>
          <button className="replay-btn" onClick={() => setRun((r) => r + 1)} aria-label="Replay this hole">
            ↻
          </button>
          <button className="replay-btn" disabled={i === tracked.length - 1} onClick={() => go(i + 1)} aria-label="Next hole">
            <ChevronRight />
          </button>
        </div>
        <div className="replay-holes">
          {tracked.map((h, k) => (
            <button key={h.number} className={`chip ${k === i ? 'on' : ''}`} onClick={() => go(k)}>
              {h.number}
            </button>
          ))}
        </div>
        <p className="replay-credit">{inQueensland(hole.tee ?? shots[0]) ? QLD_AERIAL.credit : ESRI.credit}</p>
      </div>
    </div>
  );
}
