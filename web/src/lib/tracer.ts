import type { LatLon } from '../types';
import { distanceM, fromLocal, toLocal } from './geo';

export interface Pt {
  x: number;
  y: number;
}

/** Control point so a quadratic curve from start to end passes through the apex at its midpoint. */
export function controlFromApex(start: Pt, apex: Pt, end: Pt): Pt {
  return { x: 2 * apex.x - (start.x + end.x) / 2, y: 2 * apex.y - (start.y + end.y) / 2 };
}

export function bezier(p0: Pt, c: Pt, p2: Pt, u: number): Pt {
  const a = (1 - u) * (1 - u);
  const b = 2 * (1 - u) * u;
  const d = u * u;
  return { x: a * p0.x + b * c.x + d * p2.x, y: a * p0.y + b * c.y + d * p2.y };
}

/**
 * How far along its flight the ball is at video time t. A golf ball leaves
 * the club fast and slows down, so the line races out then eases in.
 */
export function flightProgress(t: number, t0: number, t1: number): number {
  if (t <= t0) return 0;
  if (t >= t1 || t1 <= t0) return 1;
  const x = (t - t0) / (t1 - t0);
  return 1 - Math.pow(1 - x, 1.8);
}

/** Points along the traced flight, from launch to the current progress. */
export function tracePoints(start: Pt, apex: Pt, end: Pt, progress: number, steps = 60): Pt[] {
  const c = controlFromApex(start, apex, end);
  const n = Math.max(2, Math.round(steps * progress));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) out.push(bezier(start, c, end, (i / n) * progress));
  return out;
}

export interface TracerStyle {
  color: string;
  width: number;
}

/** Draw the tracer: a soft glow, a solid core, and a bright "ball" at the head while it's in flight. */
export function drawTracer(ctx: CanvasRenderingContext2D, pts: Pt[], style: TracerStyle, inFlight: boolean) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  };
  ctx.shadowColor = style.color;
  ctx.shadowBlur = style.width * 3;
  ctx.strokeStyle = style.color;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = style.width * 2.2;
  path();
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.shadowBlur = style.width;
  ctx.lineWidth = style.width;
  path();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = Math.max(1, style.width * 0.35);
  path();
  ctx.stroke();
  if (inFlight) {
    const h = pts[pts.length - 1];
    ctx.fillStyle = '#fff';
    ctx.shadowColor = style.color;
    ctx.shadowBlur = style.width * 4;
    ctx.beginPath();
    ctx.arc(h.x, h.y, style.width * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * A gently curved line between two GPS points for drawing a shot on the map
 * (a straight line looks like a measurement, an arc reads as a ball flight).
 */
export function arcLatLngs(a: LatLon, b: LatLon, bend = 0.12, steps = 24): LatLon[] {
  const p = toLocal(a, b);
  const len = Math.hypot(p.x, p.y);
  if (len < 1) return [a, b];
  // control point offset to the right of the line of play
  const mid = { x: p.x / 2, y: p.y / 2 };
  const c = { x: mid.x + (p.y / len) * len * bend, y: mid.y - (p.x / len) * len * bend };
  const out: LatLon[] = [];
  for (let i = 0; i <= steps; i++) {
    const q = bezier({ x: 0, y: 0 }, c, p, i / steps);
    out.push(fromLocal(a, q.x, q.y));
  }
  return out;
}

export interface ShotLeg {
  from: LatLon;
  to: LatLon;
  club?: string;
  distance: number;
  index: number;
}

/** Each marked shot runs to where the next one was hit from; the last one to the green if it's mapped. */
export function shotLegs(shots: { lat: number; lon: number; club?: string }[], greenCentre?: LatLon, lastPuttHoled = false): ShotLeg[] {
  const legs: ShotLeg[] = [];
  for (let i = 0; i < shots.length; i++) {
    const from = shots[i];
    // The last shot finishes at the green (or, for a putt, in the hole when we know where the hole is)
    const to = shots[i + 1] ?? (greenCentre && (lastPuttHoled || !/putt/i.test(from.club ?? '')) ? greenCentre : undefined);
    if (!to) continue;
    const distance = distanceM(from, to);
    // Short putts count; anything else under 3 m is GPS jitter
    if (distance < (/putt/i.test(from.club ?? '') ? 0.3 : 3)) continue;
    legs.push({ from, to, club: from.club, distance, index: i });
  }
  return legs;
}
