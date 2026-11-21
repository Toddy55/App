import { useState } from 'react';
import type { Round } from '../types';
import { shotLegs } from '../lib/tracer';
import { fmtDist } from '../lib/geo';
import { HoleMap } from './HoleMap';
import { Card } from './ui';

/** After the round: watch each hole's shots trace across the satellite map. */
export function ShotReplay({ round, units }: { round: Round; units: 'm' | 'yd' }) {
  const tracked = round.holes.filter((h) => (round.shots[h.number]?.length ?? 0) > 0);
  const [holeNo, setHoleNo] = useState(tracked[0]?.number);
  const [run, setRun] = useState(0);
  if (!tracked.length || holeNo == null) return null;
  const hole = round.holes.find((h) => h.number === holeNo)!;
  const shots = round.shots[holeNo] ?? [];
  const legs = shotLegs(shots, hole.green?.centre);
  const gross = round.scores[round.meId]?.[holeNo];

  return (
    <Card title="🎯 Shot replay">
      <div className="hole-chips">
        {tracked.map((h) => (
          <button
            key={h.number}
            className={`chip ${h.number === holeNo ? 'on' : ''}`}
            onClick={() => {
              setHoleNo(h.number);
              setRun((n) => n + 1);
            }}
          >
            {h.number}
          </button>
        ))}
      </div>
      <div className="row between">
        <div>
          <strong>
            Hole {hole.number} · par {hole.par}
          </strong>
          {gross != null && <span className="muted small"> · you made {gross}</span>}
        </div>
        <button className="btn small" onClick={() => setRun((n) => n + 1)}>
          ▶ Replay
        </button>
      </div>
      <HoleMap key={`${holeNo}-${run}`} hole={hole} shots={shots} units={units} finishToGreen animate centre={hole.green?.centre ?? shots[0]} height={320} />
      <ol className="shot-list">
        {legs.map((l) => (
          <li key={l.index}>
            <strong>{l.club ?? 'Shot'}</strong> {fmtDist(l.distance, units)}
            {units}
            {l.index === shots.length - 1 && hole.green ? <span className="muted small"> (to the middle of the green)</span> : null}
          </li>
        ))}
      </ol>
      <p className="muted small">Shots come from "Mark shot from here" during the round.</p>
    </Card>
  );
}
