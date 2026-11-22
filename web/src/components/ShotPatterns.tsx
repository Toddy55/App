import { useMemo, useState } from 'react';
import type { Round } from '../types';
import { patternSummary, shotPatterns, type PatternKind, type PatternShot } from '../lib/patterns';
import { Card, Segmented } from './ui';

const KINDS: { value: PatternKind; label: string }[] = [
  { value: 'drives', label: 'Drives' },
  { value: 'fairway', label: 'Fairway' },
  { value: 'chips', label: 'Chips' },
  { value: 'putts', label: 'Putts' },
];

const COLOURS = ['#c6f432', '#38bdf8', '#f472b6', '#fbbf24', '#a78bfa', '#34d399', '#fb923c', '#f87171'];

/**
 * After the round (or across rounds): every drive, fairway shot, chip or putt
 * laid over each other so the pattern jumps out.
 */
export function ShotPatterns({ rounds, title = '📊 Shot patterns' }: { rounds: Round[]; title?: string }) {
  const all = useMemo(() => shotPatterns(rounds), [rounds]);
  const first = KINDS.find((k) => all[k.value].length)?.value ?? 'drives';
  const [kind, setKind] = useState<PatternKind>(first);
  const shots = all[kind];
  if (!KINDS.some((k) => all[k.value].length)) return null;
  const clubs = [...new Set(shots.map((s) => s.club ?? '?'))];
  const colour = (s: PatternShot) => COLOURS[clubs.indexOf(s.club ?? '?') % COLOURS.length];

  return (
    <Card title={title}>
      <Segmented value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k.value, label: `${k.label}${all[k.value].length ? ` ${all[k.value].length}` : ''}` }))} />
      {shots.length === 0 ? (
        <p className="muted small">No {KINDS.find((k) => k.value === kind)!.label.toLowerCase()} tracked yet. Mark shots during the round (button or "Hey Siri, mark shot") and they'll show up here.</p>
      ) : kind === 'drives' ? (
        <DriveChart shots={shots} colour={colour} />
      ) : (
        <TargetChart shots={shots} colour={colour} putts={kind === 'putts'} />
      )}
      {shots.length > 0 && (
        <>
          {clubs.length > 1 && (
            <div className="pattern-key">
              {clubs.map((c) => (
                <span key={c}>
                  <i style={{ background: COLOURS[clubs.indexOf(c) % COLOURS.length] }} /> {c}
                </span>
              ))}
            </div>
          )}
          <ul className="pattern-notes">
            {patternSummary(kind, shots).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/** Every drive from one tee: up the screen is down the line of play. */
function DriveChart({ shots, colour }: { shots: PatternShot[]; colour: (s: PatternShot) => string }) {
  const W = 320;
  const H = 360;
  const maxAlong = Math.max(150, ...shots.map((s) => s.along)) + 20;
  const maxSide = Math.max(35, ...shots.map((s) => Math.abs(s.right))) + 8;
  const k = Math.min((H - 30) / maxAlong, (W / 2 - 14) / maxSide);
  const X = (r: number) => W / 2 + r * k;
  const Y = (a: number) => H - 14 - a * k;
  const rings = [];
  for (let d = 50; d < maxAlong; d += 50) rings.push(d);
  const avg = { a: shots.reduce((t, s) => t + s.along, 0) / shots.length, r: shots.reduce((t, s) => t + s.right, 0) / shots.length };
  return (
    <svg className="pattern-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Your drives laid over each other">
      <rect x={X(-15)} y={Y(maxAlong)} width={30 * k} height={Y(0) - Y(maxAlong)} className="pc-fairway" />
      <line x1={X(0)} y1={Y(0)} x2={X(0)} y2={Y(maxAlong)} className="pc-line" />
      {rings.map((d) => (
        <g key={d}>
          <path d={`M${X(-maxSide)},${Y(d)} Q${X(0)},${Y(d) - 10} ${X(maxSide)},${Y(d)}`} className="pc-ring" />
          <text x={X(-maxSide) + 4} y={Y(d) - 4} className="pc-label">
            {d} m
          </text>
        </g>
      ))}
      {shots.map((s, i) => (
        <g key={i}>
          <path d={`M${X(0)},${Y(0)} Q${X(s.right * 0.35)},${Y(s.along * 0.55)} ${X(s.right)},${Y(s.along)}`} stroke={colour(s)} className="pc-trace" />
          <circle cx={X(s.right)} cy={Y(s.along)} r={5} fill={colour(s)} className="pc-dot" />
          <text x={X(s.right) + 7} y={Y(s.along) + 4} className="pc-hole">
            {s.hole}
          </text>
        </g>
      ))}
      <circle cx={X(avg.r)} cy={Y(avg.a)} r={9} className="pc-avg" />
      <circle cx={X(0)} cy={Y(0)} r={5} className="pc-tee" />
      <text x={W - 6} y={14} className="pc-label end">
        ↑ line of play
      </text>
    </svg>
  );
}

/** Where each shot finished around the flag: up is long, down is short. */
function TargetChart({ shots, colour, putts }: { shots: PatternShot[]; colour: (s: PatternShot) => string; putts: boolean }) {
  const W = 320;
  const H = 320;
  const far = Math.max(putts ? 2 : 10, ...shots.map((s) => Math.hypot(s.along, s.right))) * 1.15;
  const k = (W / 2 - 16) / far;
  const X = (r: number) => W / 2 + r * k;
  const Y = (a: number) => H / 2 - a * k;
  const rings = (putts ? [0.5, 1, 2, 3, 5] : [5, 10, 20, 30, 50]).filter((d) => d < far);
  const unit = (d: number) => (putts ? `${d} m` : `${d} m`);
  return (
    <svg className="pattern-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Where your shots finished around the flag">
      {rings.map((d) => (
        <g key={d}>
          <circle cx={X(0)} cy={Y(0)} r={d * k} className="pc-ring" />
          <text x={X(0) + d * k * 0.71 + 2} y={Y(0) - d * k * 0.71 - 2} className="pc-label">
            {unit(d)}
          </text>
        </g>
      ))}
      <line x1={X(0)} y1={8} x2={X(0)} y2={H - 8} className="pc-axis" />
      <line x1={8} y1={Y(0)} x2={W - 8} y2={Y(0)} className="pc-axis" />
      <text x={X(0)} y={14} className="pc-label mid">
        LONG
      </text>
      <text x={X(0)} y={H - 4} className="pc-label mid">
        SHORT
      </text>
      <text x={8} y={Y(0) - 6} className="pc-label">
        LEFT
      </text>
      <text x={W - 8} y={Y(0) - 6} className="pc-label end">
        RIGHT
      </text>
      {shots.map((s, i) =>
        s.holed ? null : (
          <g key={i}>
            <circle cx={X(s.right)} cy={Y(s.along)} r={6} fill={colour(s)} className="pc-dot" />
            <text x={X(s.right) + 8} y={Y(s.along) + 4} className="pc-hole">
              {s.hole}
            </text>
          </g>
        ),
      )}
      <g transform={`translate(${X(0)},${Y(0)})`} className="pc-flag">
        <line x1={0} y1={0} x2={0} y2={-20} />
        <path d="M0,-20 L13,-16 L0,-12 Z" />
        <circle r={putts ? 4 : 3} />
      </g>
      {putts && shots.some((s) => s.holed) && (
        <text x={10} y={18} className="pc-label pc-holed">
          ✓ {shots.filter((s) => s.holed).length} holed
        </text>
      )}
    </svg>
  );
}
