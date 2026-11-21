import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Crosshair, Flag, Image as ImageIcon, Layers, Maximize2, Minimize2, Sparkles, X } from 'lucide-react';
import type { Hazard, Hole, LatLon, Shot } from '../types';
import { bearingDeg, centroid, distanceM, fmtDist, greenDistances, pointInPolygon } from '../lib/geo';
import { along, ESRI, makeFrame, project, tileLayout, unproject, type Frame, type Imagery } from '../lib/holeFrame';
import { landingEllipse, type Advice } from '../lib/caddy';
import { DEM_CREDIT, type Dem } from '../lib/greenDem';
import { readPutt } from '../lib/greenRead';
import { GreenSlopeLayer, fallWords, useGreenSlope } from './GreenSlope';

interface Props {
  hole: Hole;
  hazards?: Hazard[];
  /** Your GPS position (only used when you're on this hole). */
  player?: LatLon;
  onHole: boolean;
  pin?: LatLon;
  /** The target you've placed (tap or drag). */
  target?: LatLon;
  onTarget: (p: LatLon | undefined) => void;
  /** Tap in "set pin" mode. */
  onPin: (p: LatLon) => void;
  pinMode: boolean;
  onPinMode: (on: boolean) => void;
  onClearPin: () => void;
  shots: Shot[];
  advice?: Advice | null;
  showCaddy: boolean;
  onCaddyTap?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  units: 'm' | 'yd';
  playsLike?: number;
  wind?: { kmh: number; fromDeg: number };
  gpsWarning?: string;
  /** Tournament rules in force, e.g. caddy off. */
  rulesNote?: string;
  /** Ground heights around the green (slope map), when allowed. */
  dem?: Dem | null;
  /** Which photos to draw, and a way to switch (e.g. when one is out of date). */
  imagery?: Imagery;
  onSwitchImagery?: () => void;
}

const PAD = { top: 58, right: 86, bottom: 44, left: 14 };
const GREEN_PAD = { top: 64, right: 90, bottom: 70, left: 64 };

/** Full-size, turned satellite picture of the hole with every number on it. */
export function HoleView(p: Props) {
  const { hole, units } = p;
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 380, h: 560 });
  const [view, setView] = useState<'hole' | 'green'>('hole');
  const [showSlope, setShowSlope] = useState(true);
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean; target: boolean } | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => setView('hole'), [hole.number]);

  const green = hole.green!;
  const pinPt = p.pin ?? green.centre;
  const tee = hole.tee ?? hole.path?.[0];
  // Where you're playing from: you, if you're on the hole, else the tee
  const from = (p.onHole && p.player) || tee || p.player;

  const pad = { ...PAD, bottom: p.advice ? 122 : p.rulesNote ? 84 : 44 };
  const baseFrame: Frame = useMemo(() => {
    const greenPts = green.polygon?.length ? green.polygon : [green.centre];
    if (view === 'green') {
      const look = from ?? tee;
      return makeFrame({
        origin: green.centre,
        upDeg: look ? bearingDeg(look, green.centre) : 0,
        fit: [...greenPts, pinPt],
        width: size.w,
        height: size.h,
        pad: { ...GREEN_PAD, bottom: pad.bottom + 10 },
        minSpanM: 34,
      });
    }
    const start = tee ?? from ?? green.centre;
    const up = start === green.centre ? 0 : bearingDeg(start, green.centre);
    const fit = [...(tee ? [tee] : []), ...(hole.path ?? []), ...greenPts, pinPt];
    if (p.onHole && p.player) fit.push(p.player);
    return makeFrame({ origin: start, upDeg: up, fit, width: size.w, height: size.h, pad, minSpanM: 80 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, hole, size.w, size.h, pad.bottom, p.onHole, p.player?.lat, p.player?.lon, pinPt.lat, pinPt.lon]);

  // ---- Zoom: pinch, drag to look around when zoomed, or the +/- buttons
  const [zoom, setZoom] = useState({ k: 1, du: 0, dv: 0 });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => setZoom({ k: 1, du: 0, dv: 0 }), [hole.number, view]);
  const frame: Frame = useMemo(
    () => ({ ...baseFrame, scale: baseFrame.scale * zoom.k, uc: baseFrame.uc + zoom.du, vc: baseFrame.vc + zoom.dv }),
    [baseFrame, zoom],
  );
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const baseRef = useRef(baseFrame);
  baseRef.current = baseFrame;
  const gesture = useRef<{ kind: 'pinch' | 'pan'; d0: number; k0: number; g0: { u: number; v: number }; x0: number; y0: number; du0: number; dv0: number } | null>(null);
  const suppressTap = useRef(false);
  const zoomBy = (f: number) => {
    const z = zoomRef.current;
    const k = Math.max(1, Math.min(10, z.k * f));
    setZoom(k === 1 ? { k: 1, du: 0, dv: 0 } : { ...z, k });
  };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const local = (t: Touch) => {
      const r = el.getBoundingClientRect();
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    };
    const ground = (x: number, y: number) => {
      const f = frameRef.current;
      return { u: f.uc + (x - f.cx) / f.scale, v: f.vc - (y - f.cy) / f.scale };
    };
    const start = (e: TouchEvent) => {
      const z = zoomRef.current;
      if (e.touches.length === 2) {
        const a = local(e.touches[0]);
        const b = local(e.touches[1]);
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        gesture.current = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, k0: z.k, g0: ground(m.x, m.y), x0: m.x, y0: m.y, du0: z.du, dv0: z.dv };
        suppressTap.current = true;
        drag.current = null;
      } else if (e.touches.length === 1 && z.k > 1 && !drag.current?.target) {
        const a = local(e.touches[0]);
        gesture.current = { kind: 'pan', d0: 1, k0: z.k, g0: { u: 0, v: 0 }, x0: a.x, y0: a.y, du0: z.du, dv0: z.dv };
      }
    };
    const move = (e: TouchEvent) => {
      const g = gesture.current;
      const base = baseRef.current;
      if (g?.kind === 'pinch' && e.touches.length === 2) {
        e.preventDefault();
        const a = local(e.touches[0]);
        const b = local(e.touches[1]);
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const k = Math.max(1, Math.min(10, (g.k0 * Math.hypot(a.x - b.x, a.y - b.y)) / g.d0));
        const sc = base.scale * k;
        // keep the spot under your fingers under your fingers
        const uc = g.g0.u - (m.x - base.cx) / sc;
        const vc = g.g0.v + (m.y - base.cy) / sc;
        setZoom(k === 1 ? { k: 1, du: 0, dv: 0 } : { k, du: uc - base.uc, dv: vc - base.vc });
      } else if (g?.kind === 'pan' && e.touches.length === 1) {
        const a = local(e.touches[0]);
        if (Math.hypot(a.x - g.x0, a.y - g.y0) > 6) {
          e.preventDefault();
          suppressTap.current = true;
          const sc = base.scale * g.k0;
          setZoom({ k: g.k0, du: g.du0 - (a.x - g.x0) / sc, dv: g.dv0 + (a.y - g.y0) / sc });
        }
      }
    };
    const end = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        gesture.current = null;
        setTimeout(() => (suppressTap.current = false), 50);
      }
    };
    const noPageZoom = (e: Event) => e.preventDefault();
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    el.addEventListener('gesturestart', noPageZoom as EventListener);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
      el.removeEventListener('gesturestart', noPageZoom as EventListener);
    };
  }, []);

  const imagery = p.imagery ?? ESRI;
  const tiles = useMemo(() => tileLayout(frame, size.w, size.h, window.devicePixelRatio || 1, imagery), [frame, size.w, size.h, imagery]);
  // A coarser layer underneath fills any gaps (e.g. where the sharpest aerial survey ends)
  const under = useMemo(() => (tiles.z > 14 ? tileLayout(frame, size.w, size.h, 1, imagery, tiles.z - 2) : null), [frame, size.w, size.h, imagery, tiles.z]);
  const P = (q: LatLon) => project(frame, q);
  const pts = (poly: LatLon[]) => poly.map((q) => { const s = P(q); return `${s.x.toFixed(1)},${s.y.toFixed(1)}`; }).join(' ');
  const d = (m: number) => fmtDist(m, units);

  const dist = from ? greenDistances(from, green, p.pin) : undefined;
  const toGreen = from ? distanceM(from, green.centre) : 0;
  const lineBearing = from ? bearingDeg(from, pinPt) : 0;

  // Bunkers and water in play: how far to reach them and to carry them
  const hazardTags = useMemo(() => {
    if (!from || !p.hazards) return [];
    const out: { at: LatLon; reach: number; carry: number; kind: 'water' | 'bunker'; v: number }[] = [];
    for (const z of p.hazards) {
      if (z.kind === 'fairway' || z.poly.length < 3) continue;
      const c = centroid(z.poly);
      const a = along(from, lineBearing, c);
      if (a.v < 15 || a.v > toGreen + 25 || Math.abs(a.u) > 45) continue;
      const ds = z.poly.map((q) => distanceM(from, q));
      out.push({ at: c, reach: Math.min(...ds), carry: Math.max(...ds), kind: z.kind, v: a.v });
    }
    return out.sort((a, b) => a.v - b.v).slice(0, 9);
  }, [from, p.hazards, lineBearing, toGreen]);

  // Distance rings across the fairway
  const rings = useMemo(() => {
    if (!from || view === 'green') return [];
    const step = units === 'yd' ? 50 / 1.0936 : 50;
    const out: { r: number; pts: LatLon[] }[] = [];
    for (let r = step * 2; r < toGreen - 30; r += step) {
      const arc: LatLon[] = [];
      for (let i = -6; i <= 6; i++) arc.push(destination(from, lineBearing + i * 3.2, r));
      out.push({ r, pts: arc });
    }
    return out;
  }, [from, lineBearing, toGreen, units, view]);

  const target = p.target;
  const slope = useGreenSlope(p.dem, hole.green);
  const slopeOn = !!slope && showSlope && view === 'green';
  // The putt read: from where you tapped, or from you if you're on the green
  const onGreen = !!p.player && p.onHole && (green.polygon?.length ? distanceM(p.player, green.centre) < 30 : distanceM(p.player, green.centre) < 16);
  const ball = view === 'green' ? (target ?? (onGreen ? p.player : undefined)) : undefined;
  // Only read putts from on (or right on the edge of) the green
  const ballOnGreen = !!ball && (green.polygon?.length ? pointInPolygon(ball, green.polygon) || distanceToPoly(ball, green.polygon) < 2 : distanceM(ball, green.centre) < 15);
  const putt = slope && ball && ballOnGreen ? readPutt(slope.dem, ball, p.pin ?? green.centre) : null;
  // The caddy's aim and landing zone clutter the green close-up when the slope map is on
  const caddyOverlay = p.showCaddy && p.advice && !slopeOn;
  const aim = caddyOverlay ? p.advice!.best.aim : undefined;
  const zone = caddyOverlay ? landingEllipse(p.advice!.best.landing, p.advice!.from) : undefined;

  // ---- Touch: tap to place the target (or the pin), drag the target ring
  const pos = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e: React.PointerEvent) => {
    const at = pos(e);
    const onTarget = !!target && dist2(at, P(target)) < 34 * 34;
    drag.current = { id: e.pointerId, ...at, moved: false, target: onTarget };
    if (onTarget) (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const g = drag.current;
    if (!g || g.id !== e.pointerId) return;
    const at = pos(e);
    if (dist2(at, g) > 64) g.moved = true;
    if (g.target && g.moved && !gesture.current) p.onTarget(unproject(frame, at.x, at.y));
  };
  const onUp = (e: React.PointerEvent) => {
    const g = drag.current;
    drag.current = null;
    if (!g || g.id !== e.pointerId || g.moved || suppressTap.current) return;
    const at = pos(e);
    const q = unproject(frame, at.x, at.y);
    if (p.pinMode) {
      p.onPin(q);
      p.onPinMode(false);
    } else p.onTarget(q);
  };

  const youPt = from ? P(from) : undefined;
  const pinS = P(pinPt);
  const windRel = p.wind ? p.wind.fromDeg + 180 - frame.upDeg : 0;

  // Put each hazard's label where it doesn't cover another label, the flag, the aim or the panels
  const placed: { x: number; y: number; h: (typeof hazardTags)[number] }[] = [];
  {
    const W = 66, Hh = 20;
    const blocked: { x: number; y: number; w: number; h: number }[] = [
      { x: pinS.x - 6, y: pinS.y - 30, w: 26, h: 34 },
      { x: size.w - PAD.right - 4, y: 0, w: PAD.right + 4, h: size.h },
      { x: 0, y: 0, w: 66, h: 260 },
      { x: 0, y: 0, w: size.w, h: 54 },
      { x: 0, y: size.h - pad.bottom + 4, w: size.w, h: pad.bottom },
    ];
    if (aim) blocked.push({ x: P(aim).x - 16, y: P(aim).y - 16, w: 32, h: 32 });
    if (youPt) blocked.push({ x: youPt.x - 10, y: youPt.y - 10, w: 20, h: 20 });
    const hit = (x: number, y: number) =>
      blocked.some((b) => x - W / 2 < b.x + b.w && x + W / 2 > b.x && y - Hh / 2 < b.y + b.h && y + Hh / 2 > b.y);
    for (const h of hazardTags) {
      const c = P(h.at);
      const side = c.x < (youPt?.x ?? size.w / 2) ? -1 : 1;
      const tries = [
        [0, 0],
        [side * 44, 0],
        [0, -22],
        [0, 22],
        [side * 44, -22],
        [side * 44, 22],
        [-side * 44, 0],
      ];
      const spot = tries.map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy })).find((q) => !hit(q.x, q.y));
      if (!spot) continue;
      placed.push({ ...spot, h });
      blocked.push({ x: spot.x - W / 2 - 3, y: spot.y - Hh / 2 - 2, w: W + 6, h: Hh + 4 });
      if (placed.length >= 6) break;
    }
  }

  return (
    <div className={`hole-view ${p.pinMode ? 'pin-mode' : ''}`} ref={box}>
      <svg
        width={size.w}
        height={size.h}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => (drag.current = null)}
        style={{ touchAction: zoom.k > 1 ? 'none' : 'pan-y' }}
      >
        {under && (
          <g transform={under.matrix}>
            {under.tiles.map((t) => (
              <image key={t.key} href={t.href} x={t.x} y={t.y} width={256.6} height={256.6} preserveAspectRatio="none" />
            ))}
          </g>
        )}
        <g transform={tiles.matrix}>
          {tiles.tiles.map((t) => (
            <image key={t.key} href={t.href} x={t.x} y={t.y} width={256.6} height={256.6} preserveAspectRatio="none" />
          ))}
        </g>
        <rect width={size.w} height={size.h} className="hv-shade" />

        {p.hazards?.map((z, i) =>
          z.kind === 'fairway' ? null : <polygon key={i} points={pts(z.poly)} className={`hv-haz ${z.kind}`} />,
        )}
        {green.polygon && <polygon points={pts(green.polygon)} className={`hv-green ${slopeOn ? 'with-slope' : ''}`} />}
        {slopeOn && slope && <GreenSlopeLayer data={slope} frame={frame} tiles={tiles} green={green} putt={putt} ball={ball} hole={p.pin ?? green.centre} />}

        {rings.map((r) => (
          <g key={r.r} className="hv-ring">
            <polyline points={pts(r.pts)} />
            <text x={P(r.pts[r.pts.length - 1]).x + 4} y={P(r.pts[r.pts.length - 1]).y + 4}>
              {d(r.r)}
            </text>
          </g>
        ))}

        {zone && <polygon points={pts(zone)} className="hv-zone" />}
        {aim && youPt && <line x1={youPt.x} y1={youPt.y} x2={P(aim).x} y2={P(aim).y} className="hv-aimline" />}

        {/* Shots you've marked on this hole */}
        {p.shots.length > 0 && <polyline points={pts([...p.shots, ...(p.onHole && p.player ? [p.player] : [])])} className="hv-shots" />}
        {p.shots.map((s, i) => (
          <g key={s.t}>
            <circle cx={P(s).x} cy={P(s).y} r={8} className="hv-shot" />
            <text x={P(s).x} y={P(s).y + 3.5} className="hv-shot-n">
              {i + 1}
            </text>
          </g>
        ))}

        {/* You → target → pin, with the distances on the lines */}
        {youPt && !target && view === 'hole' && <Leg a={youPt} b={pinS} label={`${d(distanceM(from!, pinPt))}`} />}
        {youPt && target && !putt && (
          <>
            <Leg a={youPt} b={P(target)} label={d(distanceM(from!, target))} strong />
            <Leg a={P(target)} b={pinS} label={d(distanceM(target, pinPt))} />
          </>
        )}

        {placed.map(({ x, y, h }, i) => {
          return (
            <g key={i} className={`hv-tag ${h.kind}`} transform={`translate(${x} ${y})`}>
              <rect x={-33} y={-10} width={66} height={20} rx={10} />
              <text y={4}>
                {d(h.reach)}
                <tspan className="sep"> · </tspan>
                {d(h.carry)}
              </text>
            </g>
          );
        })}

        {aim && (
          <g transform={`translate(${P(aim).x} ${P(aim).y})`} className="hv-aim">
            <circle r={11} />
            <path d="M-16 0h8M8 0h8M0 -16v8M0 8v8" />
          </g>
        )}
        {tee && view === 'hole' && <circle cx={P(tee).x} cy={P(tee).y} r={6} className="hv-tee" />}
        <g transform={`translate(${pinS.x} ${pinS.y})`} className="hv-pin">
          <path d="M0 0V-26" />
          <path d="M0 -26l14 5-14 5z" />
          <circle r={3} />
        </g>
        {target && (
          <g transform={`translate(${P(target).x} ${P(target).y})`} className="hv-target" style={{ touchAction: 'none' }}>
            <circle r={26} className="hit" />
            <circle r={13} />
            <circle r={3} className="dot" />
          </g>
        )}
        {p.onHole && p.player && <circle cx={P(p.player).x} cy={P(p.player).y} r={8} className="hv-me" />}
      </svg>

      {/* ---- Numbers on the picture */}
      <div className="hv-top">
        <div className="hv-hole">
          {p.onPrev && (
            <button className="hv-nav" onClick={p.onPrev} aria-label="Previous hole">
              <ChevronLeft />
            </button>
          )}
          <span className="hv-no">{hole.number}</span>
          <span className="hv-par">
            Par {hole.par}
            <small>
              {hole.lengthM ? `${d(hole.lengthM)}${units} · ` : ''}SI {hole.si}
            </small>
          </span>
          {p.onNext && (
            <button className="hv-nav" onClick={p.onNext} aria-label="Next hole">
              <ChevronRight />
            </button>
          )}
        </div>
        {p.wind && (
          <div className="hv-wind" title="Wind, relative to the hole">
            <span className="arrow" style={{ transform: `rotate(${windRel}deg)` }}>
              ↑
            </span>
            {Math.round(p.wind.kmh)}
            <small>km/h</small>
          </div>
        )}
      </div>

      {dist && (
        <div className="hv-yards">
          <div>
            <small>Back</small>
            {d(dist.back)}
          </div>
          <div className="main">
            <small>{p.pin ? 'Pin' : 'Centre'}</small>
            {d(dist.pin)}
          </div>
          <div>
            <small>Front</small>
            {d(dist.front)}
          </div>
          {p.onHole && p.playsLike != null && Math.abs(p.playsLike - dist.pin) >= 2 && (
            <div className="plays">
              <small>Plays</small>
              {d(p.playsLike)}
            </div>
          )}
          {!p.onHole && <div className="from">from tee</div>}
        </div>
      )}

      <div className="hv-tools">
        <button className="hv-btn" onClick={() => setView(view === 'hole' ? 'green' : 'hole')} aria-label={view === 'hole' ? 'Zoom to the green' : 'Whole hole'}>
          {view === 'hole' ? <Maximize2 /> : <Minimize2 />}
          <span>{view === 'hole' ? 'Green' : 'Hole'}</span>
        </button>
        <button className={`hv-btn ${p.pinMode ? 'on' : ''}`} onClick={() => p.onPinMode(!p.pinMode)} aria-label="Set the pin">
          <Flag />
          <span>{p.pinMode ? 'Tap pin' : 'Pin'}</span>
        </button>
        {p.pinMode && p.pin && (
          <button className="hv-btn" onClick={() => { p.onClearPin(); p.onPinMode(false); }} aria-label="Remove the pin">
            <X />
            <span>No pin</span>
          </button>
        )}
        {p.onSwitchImagery && (
          <button className="hv-btn" onClick={p.onSwitchImagery} aria-label="Switch photos">
            <ImageIcon />
            <span>{imagery.id === 'qld' ? 'Qld HD' : 'Esri'}</span>
          </button>
        )}
        {view === 'green' && slope && (
          <button className={`hv-btn ${showSlope ? 'on' : ''}`} onClick={() => setShowSlope(!showSlope)} aria-label="Slope map">
            <Layers />
            <span>Slope</span>
          </button>
        )}
        {target && (
          <button className="hv-btn" onClick={() => p.onTarget(undefined)} aria-label="Clear the target">
            <X />
            <span>Clear</span>
          </button>
        )}
      </div>

      {slopeOn && slope && (
        <div className="hv-caddy hv-putt">
          {putt ? (
            <span className="aim">⛳ {putt.text}</span>
          ) : ball && !ballOnGreen ? (
            <span className="aim">That's off the green. Tap where your ball is on the green for the putt read.</span>
          ) : (
            <span className="aim">
              {slope.summary && slope.summary.tilt.pct >= 0.5 ? `Falls to ${fallWords(slope.summary.tilt.downhillDeg, frame.upDeg)} (${slope.summary.tilt.pct.toFixed(1)}%)` : 'Fairly flat overall'}
              {slope.summary ? `, up to ${slope.summary.p90.toFixed(1)}% in places.` : '.'} Tap where your ball is for the putt read.
            </span>
          )}
          <span className="gs-legend" aria-hidden>
            <i />
            <small>flat · 2% · 4%+</small>
          </span>
        </div>
      )}
      <div className="hv-zoom" style={{ bottom: pad.bottom + 10 }}>
        <button className="hv-btn" onClick={() => zoomBy(1.6)} aria-label="Zoom in">
          +
        </button>
        <button className="hv-btn" disabled={zoom.k <= 1} onClick={() => zoomBy(1 / 1.6)} aria-label="Zoom out">
          −
        </button>
        {zoom.k > 1 && (
          <button className="hv-btn small" onClick={() => setZoom({ k: 1, du: 0, dv: 0 })} aria-label="Reset zoom">
            Fit
          </button>
        )}
      </div>
      {p.advice && !slopeOn && (
        <button className={`hv-caddy ${p.showCaddy ? '' : 'off'}`} onClick={p.onCaddyTap}>
          <Sparkles />
          <span className="club">{p.advice.headline}</span>
          <span className="aim">{p.advice.aimText}</span>
        </button>
      )}
      {!target && !p.pinMode && !slopeOn && (
        <div className="hv-hint">
          <Crosshair /> Tap anywhere for distances
        </div>
      )}
      {p.pinMode && <div className="hv-hint on">Tap where the pin is today</div>}
      {p.gpsWarning && <div className="hv-gps">{p.gpsWarning}</div>}
      {p.rulesNote && !p.advice && <div className="hv-rules">{p.rulesNote}</div>}
      <div className="hv-credit">{imagery.credit}{slopeOn ? ` · ${DEM_CREDIT}` : ''}</div>
    </div>
  );
}

function Leg({ a, b, label, strong }: { a: { x: number; y: number }; b: { x: number; y: number }; label: string; strong?: boolean }) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  return (
    <g className={`hv-leg ${strong ? 'strong' : ''}`}>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      <g transform={`translate(${mx} ${my})`}>
        <rect x={-21} y={-11} width={42} height={22} rx={11} />
        <text y={5}>{label}</text>
      </g>
    </g>
  );
}

const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** Point `m` metres from `p` on a bearing. */
function destination(p: LatLon, brg: number, m: number): LatLon {
  const b = (brg * Math.PI) / 180;
  const dLat = (m * Math.cos(b)) / 111320;
  const dLon = (m * Math.sin(b)) / (111320 * Math.cos((p.lat * Math.PI) / 180));
  return { lat: p.lat + dLat, lon: p.lon + dLon };
}

/** Rough distance (m) from a point to the nearest corner of an outline. */
function distanceToPoly(p: LatLon, poly: LatLon[]) {
  return Math.min(...poly.map((q) => distanceM(p, q)));
}
