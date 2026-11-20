import { store } from '../lib/storage';
import { computeResult, FORMAT_LABELS, toParLabel } from '../lib/scoring';
import { Card, Header, type Go } from '../components/ui';
import { computeComp } from '../lib/comps';
import { JoinLive } from '../live/LiveView';
import { InstallTip } from '../components/InstallTip';

const ordinal = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');

export function Home({ go }: { go: Go }) {
  const rounds = store.rounds().sort((a, b) => b.startedAt - a.startedAt);
  const live = rounds.find((r) => !r.completed);
  const done = rounds.filter((r) => r.completed);
  const settings = store.settings();
  const allRounds = store.rounds();
  const liveComps = store
    .comps()
    .map((c) => ({ c, res: computeComp(c, allRounds, (id) => store.nameOf(id)) }))
    .filter((x) => x.res.status !== 'complete')
    .slice(0, 3);

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
          <button className="tile" onClick={() => go({ name: 'leaderboards' })}>
            <span className="tile-icon">🏆</span>
            <span>Leaderboards</span>
          </button>
          <button className="tile" onClick={() => go({ name: 'friends' })}>
            <span className="tile-icon">👥</span>
            <span>Friends</span>
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

        <InstallTip />

        <JoinLive go={go} />

        {liveComps.length > 0 && (
          <Card title="Comps">
            <ul className="list">
              {liveComps.map(({ c, res }) => {
                const me = res.standings.find((x) => x.playerId === 'me');
                const leader = res.standings.find((x) => x.played);
                return (
                  <li key={c.id}>
                    <button className="list-btn" onClick={() => go({ name: 'comp', id: c.id })}>
                      <div>
                        <strong>{c.name}</strong>
                        <div className="muted small">{leader ? `${leader.name} leads · ` : ''}{res.rounds.length} rounds{res.remaining != null ? `, ${res.remaining} to go` : ''}</div>
                      </div>
                      {me?.played ? <span className="score-pill">You: {me.rank}{ordinal(me.rank)}</span> : <span>›</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

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
                        {r.sharedBy ? ` · from ${r.sharedBy}` : ''}
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
