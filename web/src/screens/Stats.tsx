import { store } from '../lib/storage';
import { ShotPatterns } from '../components/ShotPatterns';
import { clubDistances, toPar, trends } from '../lib/analysis';
import { fmtDist } from '../lib/geo';
import { Card, Header, type Go } from '../components/ui';

export function Stats({ go }: { go: Go }) {
  const settings = store.settings();
  const rounds = store.rounds();
  const t = trends(rounds, settings.me.gaHandicap);
  const clubs = clubDistances(rounds);
  const units = settings.units;
  const avg = (xs: (number | undefined)[]) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
  };
  const focusCounts = t.reduce<Record<string, number>>((m, r) => {
    if (r.topFocus) m[r.topFocus] = (m[r.topFocus] ?? 0) + 1;
    return m;
  }, {});
  const recurring = Object.entries(focusCounts).sort((a, b) => b[1] - a[1])[0];
  const maxAbs = Math.max(1, ...t.map((r) => Math.abs(r.toPar / (r.holes || 18)) * 18));

  return (
    <div className="screen">
      <Header title="My stats" onBack={() => go({ name: 'home' })} />
      <div className="content">
        {t.length === 0 ? (
          <Card>
            <p className="muted">Finish a round to start building your stats.</p>
          </Card>
        ) : (
          <>
            <Card title={`Last ${t.length} round${t.length > 1 ? 's' : ''}`}>
              <div className="kpis">
                <div className="kpi">
                  <div className="kpi-label">Putts / 18</div>
                  <div className="kpi-value">{avg(t.map((r) => r.putts18))?.toFixed(1) ?? '–'}</div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">Fairways</div>
                  <div className="kpi-value">{avg(t.map((r) => r.fir)) != null ? `${Math.round(avg(t.map((r) => r.fir))! * 100)}%` : '–'}</div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">GIR / 18</div>
                  <div className="kpi-value">{avg(t.map((r) => r.gir18))?.toFixed(1) ?? '–'}</div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">Penalties</div>
                  <div className="kpi-value">{avg(t.map((r) => r.penalties))?.toFixed(1) ?? '–'}</div>
                </div>
              </div>
              {recurring && recurring[1] >= 2 && (
                <p className="coach-callout">
                  🧠 <strong>{recurring[0]}</strong> has been your #1 leak in {recurring[1]} of your last {t.length} rounds. That's where your practice time should go.
                </p>
              )}
            </Card>
            <Card title="Score to par (per 18)">
              <div className="bars" role="img" aria-label="Score to par per round">
                {t.map((r) => {
                  const per18 = (r.toPar / (r.holes || 18)) * 18;
                  return (
                    <div key={r.id} className="bar-col" title={`${r.course} ${toPar(r.toPar)}`}>
                      <div className="bar" style={{ height: `${(Math.abs(per18) / maxAbs) * 100}%` }} />
                      <span className="bar-val">{toPar(Math.round(per18))}</span>
                      <span className="bar-label">{new Date(r.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </>
        )}
        <ShotPatterns rounds={rounds} title="📊 Shot patterns (all rounds)" />
        <Card title="Club distances (from shot tracker)">
          {clubs.length === 0 ? (
            <p className="muted">Use "Mark shot from here" during a round and your average distance per club shows up here.</p>
          ) : (
            <>
              <table className="totals">
                <thead>
                  <tr>
                    <th>Club</th>
                    <th>Full swing ({units})</th>
                    <th>Longest</th>
                    <th>Around green</th>
                  </tr>
                </thead>
                <tbody>
                  {clubs.map((c) => (
                    <tr key={c.club}>
                      <td>{c.club}</td>
                      <td>
                        {c.n ? (
                          <>
                            <strong>{fmtDist(c.avg, units)}</strong> <span className="muted small">×{c.n}</span>
                          </>
                        ) : (
                          '–'
                        )}
                      </td>
                      <td>{c.n ? fmtDist(c.max, units) : '–'}</td>
                      <td>{c.short ? `${fmtDist(c.short.avg, units)} ×${c.short.n}` : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">
                Full swing = shots from more than {fmtDist(50, units)}{units} out, minus half swings and punch-outs. Chips, pitches and bunker shots from within {fmtDist(50, units)}{units} of the green are kept separate under "Around green", so they don't drag your wedge numbers down. The caddie uses your full-swing numbers.
              </p>
            </>
          )}
          <p className="muted small">Distances are total (carry plus roll). Club off your average, not your best.</p>
        </Card>
      </div>
    </div>
  );
}
