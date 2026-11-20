import type { Round } from '../types';
import { computeResult, sidesFor, sideRows, toParLabel } from '../lib/scoring';
import { scoreClass } from './ui';

/** Full scorecard: holes across, one row per player/team. */
export function Scorecard({ round, onHole }: { round: Round; onHole?: (n: number) => void }) {
  const rows = sideRows(round, sidesFor(round));
  const result = computeResult(round);
  const showPts = round.format === 'stableford' || round.format === 'fourball';
  const showPar = round.format === 'par';
  const nines = [round.holes.filter((h) => h.number <= 9), round.holes.filter((h) => h.number > 9)].filter((n) => n.length);

  return (
    <div className="scorecard">
      {nines.map((nine, ni) => (
        <div className="sc-scroll" key={ni}>
          <table>
            <thead>
              <tr>
                <th className="sticky">Hole</th>
                {nine.map((h) => (
                  <th key={h.number} onClick={() => onHole?.(h.number)} className={onHole ? 'tap' : ''}>
                    {h.number}
                  </th>
                ))}
                <th>{ni === 0 && nine[0].number === 1 ? 'Out' : 'In'}</th>
              </tr>
              <tr className="sub">
                <th className="sticky">Par</th>
                {nine.map((h) => (
                  <th key={h.number}>{h.par}</th>
                ))}
                <th>{nine.reduce((s, h) => s + h.par, 0)}</th>
              </tr>
              <tr className="sub">
                <th className="sticky">SI</th>
                {nine.map((h) => (
                  <th key={h.number}>{h.si}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tot = nine.reduce((s, h) => s + (r.cells[h.number]?.gross ?? 0), 0);
                const pts = nine.reduce((s, h) => s + (r.cells[h.number]?.points ?? 0), 0);
                return (
                  <tr key={r.id}>
                    <td className="sticky name">{r.name}</td>
                    {nine.map((h) => {
                      const c = r.cells[h.number];
                      return (
                        <td key={h.number} className={scoreClass(c?.gross, h.par)}>
                          <span className="g">{c?.gross ?? ''}</span>
                          {c?.strokes ? <sup>{'•'.repeat(Math.min(3, Math.abs(c.strokes)))}</sup> : null}
                          {showPts && c?.points != null && <small>{c.points}</small>}
                          {showPar && c?.parResult != null && <small>{c.parResult > 0 ? '+' : c.parResult < 0 ? '−' : '0'}</small>}
                        </td>
                      );
                    })}
                    <td className="tot">
                      {tot || ''}
                      {showPts && <small>{pts}</small>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      <table className="totals">
        <thead>
          <tr>
            <th>{round.format === 'ambrose' ? 'Team' : 'Player'}</th>
            <th>Hcp</th>
            <th>Thru</th>
            <th>Gross</th>
            <th>Net</th>
            {showPts && <th>Pts</th>}
            {showPar && <th>Par</th>}
            {round.format === 'skins' && <th>Skins</th>}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{r.handicap}</td>
              <td>{r.thru}</td>
              <td>
                {r.gross} <small>({toParLabel(r.grossToPar)})</small>
              </td>
              <td>
                {r.net} <small>({toParLabel(r.netToPar)})</small>
              </td>
              {showPts && <td>{r.points}</td>}
              {showPar && <td>{r.parScore > 0 ? `+${r.parScore}` : r.parScore}</td>}
              {round.format === 'skins' && <td>{r.skins}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {result.teamRows && (
        <table className="totals">
          <thead>
            <tr>
              <th>Pair</th>
              <th>Thru</th>
              <th>Better-ball pts</th>
            </tr>
          </thead>
          <tbody>
            {result.teamRows.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{t.thru}</td>
                <td>{t.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">• = shot received on that hole</p>
    </div>
  );
}
