import { useMemo } from 'react';
import type { Green, LatLon } from '../types';
import type { Dem } from '../lib/greenDem';
import { mercToTilePx, project, type Frame, type TileLayout } from '../lib/holeFrame';
import { contours, greenCells, greenSummary, slopeColour, smooth, type PuttRead } from '../lib/greenRead';

/** Everything worked out once per green: smoothed heights, the colour map, contours and arrows. */
export function useGreenSlope(dem: Dem | null | undefined, green: Green | undefined) {
  return useMemo(() => {
    if (!dem || !green) return null;
    const sm = smooth(dem);
    const cells = greenCells(sm, green.polygon, green.centre);
    if (cells.length < 20) return null;
    const summary = greenSummary(cells);
    // Colour map: one pixel per cell, scaled up smoothly over the satellite photo
    let heat: string | null = null;
    try {
      const c = document.createElement('canvas');
      c.width = sm.w;
      c.height = sm.h;
      const ctx = c.getContext('2d');
      if (ctx) {
        const img = ctx.createImageData(sm.w, sm.h);
        for (const cell of cells) {
          const [r, g, b] = slopeColour(cell.s.pct);
          const k = (cell.j * sm.w + cell.i) * 4;
          img.data.set([r, g, b, 165], k);
        }
        ctx.putImageData(img, 0, 0);
        heat = c.toDataURL('image/png');
      }
    } catch {
      heat = null;
    }
    // Contours, then trim to the segments on or near the green
    const near = (p: LatLon) => cells.some((c) => Math.abs(c.at.lat - p.lat) < 2.5e-5 && Math.abs(c.at.lon - p.lon) < 2.5e-5);
    const lines = contours(sm, 0.1).map((l) => ({ level: l.level, segs: l.segs.filter(([a]) => near(a)) })).filter((l) => l.segs.length);
    // An arrow roughly every 3 m
    const step = Math.max(2, Math.round(3 / sm.cellM));
    const arrows = cells.filter((c) => c.i % step === 0 && c.j % step === 0 && c.s.pct >= 0.4);
    return { dem: sm, cells, summary, heat, lines, arrows };
  }, [dem, green]);
}

export type GreenSlopeData = NonNullable<ReturnType<typeof useGreenSlope>>;

/** The slope map drawn over the turned satellite picture (SVG). */
export function GreenSlopeLayer({
  data,
  frame,
  tiles,
  green,
  putt,
  ball,
  hole,
}: {
  data: GreenSlopeData;
  frame: Frame;
  tiles: TileLayout;
  green: Green;
  putt?: PuttRead | null;
  ball?: LatLon;
  hole: LatLon;
}) {
  const P = (q: LatLon) => project(frame, q);
  const { dem } = data;
  const a = mercToTilePx(dem.xmin, dem.ymax, tiles.z);
  const b = mercToTilePx(dem.xmax, dem.ymin, tiles.z);
  const clip = green.polygon?.length
    ? green.polygon.map((q) => { const s = P(q); return `${s.x.toFixed(1)},${s.y.toFixed(1)}`; }).join(' ')
    : null;
  const c0 = P(green.centre);

  // Putt line bends towards the high side by the break
  let puttPath: string | null = null;
  if (putt && ball && Math.abs(putt.breakCm) >= 4) {
    const s = P(ball);
    const e = P(hole);
    const len = Math.hypot(e.x - s.x, e.y - s.y) || 1;
    // right-hand normal on screen
    const nx = -(e.y - s.y) / len;
    const ny = (e.x - s.x) / len;
    // breaks left (breakCm > 0): the ball starts out right, so the curve bows to the right
    const off = Math.min(len * 0.45, (Math.abs(putt.breakCm) / 100) * frame.scale * 1.4) * (putt.breakCm > 0 ? 1 : -1);
    const mx = (s.x + e.x) / 2 + nx * off;
    const my = (s.y + e.y) / 2 + ny * off;
    puttPath = `M${s.x},${s.y} Q${mx},${my} ${e.x},${e.y}`;
  }

  return (
    <g className="gs-layer">
      <defs>
        <clipPath id="gs-clip">{clip ? <polygon points={clip} /> : <circle cx={c0.x} cy={c0.y} r={14 * frame.scale} />}</clipPath>
      </defs>
      <g clipPath="url(#gs-clip)">
        {data.heat && (
          <g transform={tiles.matrix}>
            <image href={data.heat} x={a.x - tiles.ox} y={a.y - tiles.oy} width={b.x - a.x} height={b.y - a.y} preserveAspectRatio="none" className="gs-heat" />
          </g>
        )}
        {data.lines.map((l) => (
          <path
            key={l.level.toFixed(2)}
            className="gs-contour"
            d={l.segs.map(([p, q]) => { const s = P(p); const t = P(q); return `M${s.x.toFixed(1)},${s.y.toFixed(1)}L${t.x.toFixed(1)},${t.y.toFixed(1)}`; }).join('')}
          />
        ))}
      </g>
      {data.arrows.map((c) => {
        const s = P(c.at);
        // arrow length 6–16 px with the slope, pointing downhill on screen
        const ang = ((c.s.downhillDeg - frame.upDeg) * Math.PI) / 180;
        const L = Math.min(16, 6 + c.s.pct * 3);
        const dx = Math.sin(ang) * L;
        const dy = -Math.cos(ang) * L;
        return (
          <g key={`${c.i}-${c.j}`} className="gs-arrow" transform={`translate(${s.x - dx / 2} ${s.y - dy / 2})`}>
            <line x1={0} y1={0} x2={dx} y2={dy} />
            <path d={`M${dx},${dy} l${-dx * 0.35 + dy * 0.25},${-dy * 0.35 - dx * 0.25} M${dx},${dy} l${-dx * 0.35 - dy * 0.25},${-dy * 0.35 + dx * 0.25}`} />
          </g>
        );
      })}
      {puttPath && <path d={puttPath} className="gs-putt" />}
      {putt && ball && Math.abs(putt.breakCm) < 4 && <line x1={P(ball).x} y1={P(ball).y} x2={P(hole).x} y2={P(hole).y} className="gs-putt" />}
    </g>
  );
}

/** "Falls to the front-right" relative to how you're looking at the green. */
export function fallWords(downhillDeg: number, upDeg: number): string {
  const rel = (((downhillDeg - upDeg) % 360) + 360) % 360;
  const names = ['the back', 'the back-right', 'the right', 'the front-right', 'the front', 'the front-left', 'the left', 'the back-left'];
  return names[Math.round(rel / 45) % 8];
}
