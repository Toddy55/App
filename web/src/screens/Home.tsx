import { store } from '../lib/storage';
import { computeResult, FORMAT_LABELS, toParLabel } from '../lib/scoring';
import { Card, Header, type Go } from '../components/ui';

export function Home({ go }: { go: Go }) {
  const rounds = store.rounds().sort((a, b) => b.startedAt - a.startedAt);
  const live = rounds.find((r) => !r.completed);
  const done = rounds.filter((r) => r.completed);
  const settings = store.settings();

  return (
    <div className="screen">
      <Header title="Fairway Coach" right={<button className="icon-btn" onClick={() => go({ name: 'settings' })} aria-label="Settings">⚙︎</button>} />
      <div className="content">
        <p className="greeting">
          G'day {settings.me.name === 'Me' ? 'legend' : settings.me.name}. GA Handicap <strong>{settings.me.gaHandicap}</strong>
        </p>

        {live && (
          <Card className="live">
            <div className="row between">
              <div>
                <div className="eyebrow">Round in progress</div>
                <strong>{live.courseName}</strong>
                <div className="muted small">{FORMAT_LABELS[live.format]}</div>
              </div>
              <button className="btn primary" onClick={() => go({ name: 'play', roundId: live.id })}>
                Resume
              </button>
            </div>
          </Card>
        )}

        <div className="grid2">
          <button className="tile" onClick={() => go({ name: 'setup' })}>
            <span className="tile-icon">🏌️</span>
            <span>New round</span>
          </button>
          <button className="tile" onClick={() => go({ name: 'courses' })}>
            <span className="tile-icon">🗺️</span>
            <span>Courses</span>
          </button>
          <button className="tile" onClick={() => go({ name: 'stats' })}>
            <span className="tile-icon">📈</span>
            <span>My stats</span>
          </button>
          <button className="tile" onClick={() => go({ name: 'settings' })}>
            <span className="tile-icon">⚙️</span>
            <span>Settings</span>
          </button>
        </div>

        <Card title="Recent rounds">
          {done.length === 0 && <p className="muted">No rounds yet. Tee one up and the coach will break it down for you afterwards.</p>}
          <ul className="list">
            {done.slice(0, 15).map((r) => {
              const res = computeResult(r);
              const me = res.rows.find((x) => x.id === r.meId) ?? res.rows[0];
              return (
                <li key={r.id}>
                  <button className="list-btn" onClick={() => go({ name: 'summary', roundId: r.id })}>
                    <div>
                      <strong>{r.courseName}</strong>
                      <div className="muted small">
                        {new Date(r.date).toLocaleDateString('en-AU')} · {FORMAT_LABELS[r.format]}
                      </div>
                    </div>
                    {me && (
                      <div className="score-pill">
                        {r.format === 'stableford' || r.format === 'fourball' ? `${me.points} pts` : `${me.gross} (${toParLabel(me.grossToPar)})`}
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </div>
  );
}
