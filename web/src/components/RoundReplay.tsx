import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react';
import type { LatLon, Round } from '../types';
import { bearingDeg, distanceM, fmtDist } from '../lib/geo';
import { ESRI, QLD_AERIAL, makeFrame, project, tileLayout, type Frame, type TileLayout } from '../lib/holeFrame';
import { GREENSIDE_M } from '../lib/analysis';
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
  // The last putt drops in the hole (when the pin was marked)
  const legs = useMemo(() => shotLegs(shots, flag, !!(hole && round.pins?.[hole.number])), [shots, flag, hole, round]);
  const total = legs.length * (LEG_S + GAP_S);

  // The clock for this hole's replay: drives the live distance counter
  const [clock, setClock] = useState(0);
  useEffect(() => {
    const start = performance.now();
    setClock(0);
    const id = setInterval(() => {
      const t = (performance.now() - start) / 1000;
      setClock(t);
      if (t > total + 1) clearInterval(id);
    }, 50);
    return () => clearInterval(id);
  }, [i, run, total]);

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
    const pad = { top: 100, right: 24, bottom: 300, left: 24 };
    const frame = makeFrame({ origin, upDeg, fit: [origin, end, ...shots, ...(flag ? [flag] : [])], width: size.w, height: size.h, pad, minSpanM: 80 });
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const qld = inQueensland(origin);
    const base = tileLayout(frame, size.w, size.h, dpr, ESRI, 18);
    const top = qld ? tileLayout(frame, size.w, size.h, dpr, QLD_AERIAL) : null;
    // From the first shot inside 50 m of the flag, zoom into the green
    const fromLeg = flag ? legs.findIndex((l) => distanceM(l.from, flag) <= GREENSIDE_M) : -1;
    let zoom: { fromLeg: number; v: { frame: Frame; base: TileLayout; top: TileLayout | null } } | null = null;
    if (flag && fromLeg >= 0) {
      const near = legs.slice(fromLeg).flatMap((l) => [l.from, l.to]);
      const zf = makeFrame({ origin, upDeg, fit: [flag, ...(hole.green?.polygon ?? []), ...near], width: size.w, height: size.h, pad: { top: 120, right: 40, bottom: 320, left: 40 }, minSpanM: 26 });
      // Only worth it if it's a real close-up
      if (zf.scale > frame.scale * 1.6) {
        zoom = { fromLeg, v: { frame: zf, base: tileLayout(zf, size.w, size.h, dpr, ESRI, 19), top: qld ? tileLayout(zf, size.w, size.h, dpr, QLD_AERIAL) : null } };
      }
    }
    return { frame, base, top, zoom };
  }, [hole, shots, flag, size, legs]);

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

  const gross = round.scores[round.meId]?.[hole.number];
  const go = (n: number) => {
    setI(Math.max(0, Math.min(tracked.length - 1, n)));
    setRun((r) => r + 1);
  };

  return (
    <div className="replay">
      <svg key={`${hole.number}-${run}`} className="replay-map" width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`}>
        {(() => {
          // Close-up on the green for the chips and putts, like the TV coverage
          const zoomAt = view.zoom ? Math.max(0, view.zoom.fromLeg * (LEG_S + GAP_S) - 0.45) : Infinity;
          const zoomed = clock >= zoomAt;
          const scene = (v: { frame: Frame; base: TileLayout; top: TileLayout | null }, opts: { fromLeg: number; big: boolean }) => {
            const PP = (p: LatLon) => project(v.frame, p);
            let tagAt: number[] = [];
            let tagSide: boolean[] = [];
            return (
              <>
                {[v.base, v.top].map((t) =>
                  t ? (
                    <g key={t.tiles[0]?.key.split('/')[0] ?? 'x'} transform={t.matrix}>
                      {t.tiles.map((tile) => (
                        <image key={tile.key} href={tile.href} x={tile.x} y={tile.y} width={256} height={256} preserveAspectRatio="none" />
                      ))}
                    </g>
                  ) : null,
                )}
                <rect width={size.w} height={size.h} className="replay-shade" />
                {hole.green?.polygon && <polygon points={hole.green.polygon.map((q) => `${PP(q).x},${PP(q).y}`).join(' ')} className="replay-green" />}
                {flag && (
                  <g transform={`translate(${PP(flag).x},${PP(flag).y})`} className="replay-flag">
                    <line x1={0} y1={0} x2={0} y2={-26} />
                    <path d="M0,-26 L16,-21 L0,-16 Z" />
                    <circle r={3} />
                  </g>
                )}
                {(() => {
                  // Keep the labels from sitting on top of each other (putts finish close together)
                  const placed: { x: number; y: number; w: number }[] = [];
                  tagSide = [];
                  tagAt = legs.map((l) => {
                    const b = PP(l.to);
                    const w = opts.big ? 112 : 96;
                    const clash = (x0: number, y: number) => placed.some((q) => Math.abs(q.x - x0) < w && Math.abs(q.y - y) < 30);
                    // Usual side, then the other side, then stack upwards
                    let right = b.x > size.w - 130;
                    let x0 = right ? b.x - 10 - w : b.x + 10;
                    if (clash(x0, b.y - 10) && b.x - 10 - w > 0 && b.x + 10 + w < size.w) {
                      right = !right;
                      x0 = right ? b.x - 10 - w : b.x + 10;
                    }
                    let dy = 0;
                    for (let n = 0; n < 6 && clash(x0, b.y - 10 + dy); n++) dy += n % 2 ? -32 * (n + 1) : 32 * (n + 1);
                    placed.push({ x: x0, y: b.y - 10 + dy, w });
                    tagSide.push(right);
                    return dy;
                  });
                  return null;
                })()}
                {legs.map((l, k) => {
                  const a = PP(l.from);
                  const b = PP(l.to);
                  const len = Math.hypot(b.x - a.x, b.y - a.y);
                  // A gentle arc so it reads as a ball in the air, like the TV tracers
                  const putt = /putt/i.test(l.club ?? '');
                  const bend = putt ? 0 : Math.min(60, len * 0.16);
                  const c = { x: (a.x + b.x) / 2 + ((b.y - a.y) / (len || 1)) * bend * 0.35, y: (a.y + b.y) / 2 - ((b.x - a.x) / (len || 1)) * bend * 0.35 - bend * 0.25 };
                  const d = `M${a.x},${a.y} Q${c.x},${c.y} ${b.x},${b.y}`;
                  const delay = k * (LEG_S + GAP_S);
                  // In the close-up, shots before the zoom are already done: draw them settled
                  const settled = k < opts.fromLeg;
                  const style = settled ? { animation: 'none', strokeDashoffset: 0 } : { animationDelay: `${delay}s`, animationDuration: `${LEG_S}s` };
                  const w = opts.big ? 112 : 96;
                  const right = tagSide[k] ?? b.x > size.w - 130;
                  return (
                    <g key={k} className={settled ? 'replay-settled' : ''}>
                      <path d={d} className="replay-trail" pathLength={1} style={style} />
                      <path d={d} className={`replay-line ${putt ? 'putt' : ''}`} pathLength={1} style={style} />
                      {!settled && (
                        <circle r={opts.big ? 6 : 5} className="replay-ball">
                          <animateMotion path={d} begin={`${delay}s`} dur={`${LEG_S}s`} fill="freeze" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.2 0.6 0.4 1" />
                        </circle>
                      )}
                      <g className={`replay-tag ${opts.big ? 'big' : ''}`} style={settled ? { animation: 'none', opacity: 1 } : { animationDelay: `${delay + LEG_S * 0.8}s` }} transform={`translate(${b.x},${b.y})`}>
                        <circle r={4} className="replay-land" />
                        {tagAt[k] ? <line x1={0} y1={0} x2={right ? -10 : 10} y2={tagAt[k] - 4} className="replay-tagline" /> : null}
                        <g transform={`translate(${right ? -10 : 10},${-10 + (tagAt[k] ?? 0)})`}>
                          <rect x={right ? -w : 0} y={-14} width={w} height={opts.big ? 28 : 24} rx={opts.big ? 14 : 12} />
                          <text x={right ? -w / 2 : w / 2} y={opts.big ? 5 : 3}>
                            {(l.club ?? `Shot ${k + 1}`).slice(0, 8)} · {l.distance < 30 ? `${(units === 'yd' ? l.distance * 1.0936 : l.distance).toFixed(1)}` : fmtDist(l.distance, units)}
                            {units}
                          </text>
                        </g>
                      </g>
                    </g>
                  );
                })}
                {legs[0] && !opts.big && <circle cx={PP(legs[0].from).x} cy={PP(legs[0].from).y} r={6} className="replay-tee" />}
              </>
            );
          };
          // The whole hole flies into the close-up: scale it about the flag so the move reads as a zoom
          let move = 'none';
          if (view.zoom && flag) {
            const a = project(view.frame, flag);
            const b = project(view.zoom.v.frame, flag);
            const k = view.zoom.v.frame.scale / view.frame.scale;
            move = `translate(${b.x - a.x}px, ${b.y - a.y}px) scale(${k})`;
            return (
              <>
                <g className="replay-scene" style={{ transformOrigin: `${a.x}px ${a.y}px`, transform: zoomed ? move : 'none', opacity: zoomed ? 0 : 1 }}>
                  {scene(view, { fromLeg: 0, big: false })}
                </g>
                <g className="replay-scene close" style={{ opacity: zoomed ? 1 : 0 }}>
                  {scene(view.zoom.v, { fromLeg: view.zoom.fromLeg, big: true })}
                </g>
              </>
            );
          }
          return scene(view, { fromLeg: 0, big: false });
        })()}
      </svg>
      {view.zoom && clock >= Math.max(0, view.zoom.fromLeg * (LEG_S + GAP_S) - 0.45) && <div className="replay-zoom-tag">🔍 Around the green</div>}

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

      {legs.length > 0 && (() => {
        // Which shot is flying now, and how far it's gone
        const k = Math.min(legs.length - 1, Math.floor(clock / (LEG_S + GAP_S)));
        const p = Math.max(0, Math.min(1, (clock - k * (LEG_S + GAP_S)) / LEG_S));
        const eased = 1 - Math.pow(1 - p, 2.2);
        const l = legs[k];
        const landed = p >= 1;
        const left = flag ? distanceM(l.to, flag) : null;
        const done = clock > total;
        const totalM = legs.reduce((a, x) => a + x.distance, 0);
        return (
          <>
            <div className="replay-bottom">
            <div className={`replay-ticker ${landed ? 'landed' : ''} ${done ? 'done' : ''}`}>
              {done ? (
                <>
                  <span className="rt-club">Hole {hole.number} done</span>
                  <span className="rt-dist">
                    {shots.length} shot{shots.length === 1 ? '' : 's'}
                    {gross != null ? ` · made ${gross}` : ''}
                  </span>
                  <span className="rt-left">{fmtDist(totalM, units)}{units} hit in total</span>
                </>
              ) : (
                <>
                  <span className="rt-club">
                    Shot {k + 1}
                    {l.club ? ` · ${l.club}` : ''}
                  </span>
                  <span className="rt-dist">
                    {l.distance < 30 ? ((units === 'yd' ? 1.0936 : 1) * l.distance * eased).toFixed(1) : fmtDist(l.distance * eased, units)}
                    <small>{units}</small>
                  </span>
                  <span className="rt-left">{landed && left != null ? (left < 1.5 ? 'In the hole 🎉' : `${fmtDist(left, units)}${units} to the pin`) : '\u00a0'}</span>
                </>
              )}
            </div>
            <div className="replay-shots">
              {legs.map((x, j) => {
                const shown = clock >= j * (LEG_S + GAP_S) + LEG_S;
                return (
                  <span key={j} className={`rs-chip ${shown ? 'on' : ''}`}>
                    <b>{j + 1}</b> {x.club ?? 'Shot'} <strong>{x.distance < 30 ? (units === 'yd' ? x.distance * 1.0936 : x.distance).toFixed(1) : fmtDist(x.distance, units)}{units}</strong>
                  </span>
                );
              })}
            </div>
            </div>
          </>
        );
      })()}

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
