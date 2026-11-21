import { store } from '../lib/storage';
import { computeResult, FORMAT_LABELS, toParLabel } from '../lib/scoring';
import { Card, Header, type Go } from '../components/ui';
import { computeComp } from '../lib/comps';
import { JoinLive } from '../live/LiveView';
import { InstallTip } from '../components/InstallTip';
import { ChartColumn, ChevronRight, Flag, Map as MapIcon, Settings as SettingsIcon, Trophy, Users, Video } from 'lucide-react';

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
  const bestPts = done.filter((r) => r.format === 'stableford').reduce<number | null>((best, r) => {
    const me = computeResult(r).rows.find((x) => x.id === r.meId);
    return me && (best == null || me.points > best) ? me.points : best;
  }, null);

  return (
    <div className="screen">
      <Header
        title="Fairway Coach"
        right={
          <button className="icon-btn" onClick={() => go({ name: 'settings' })} aria-label="Settings">
            <SettingsIcon />
          </button>
        }
      />
      <div className="content">
        <section className="hero">
          <div className="hero-hi">G'day</div>
          <div className="hero-name">{settings.me.name === 'Me' ? 'legend' : settings.me.name}</div>
          <div className="hero-stats">
            <div className="hero-stat">
              <b>{settings.me.gaHandicap}</b>
              <span>GA handicap</span>
            </div>
            <div className="hero-stat">
              <b>{done.length}</b>
              <span>Rounds</span>
            </div>
            {bestPts != null && (
              <div className="hero-stat">
                <b>{bestPts}</b>
                <span>Best pts</span>
              </div>
            )}
          </div>
          {live ? (
            <button className="btn primary block" onClick={() => go({ name: 'play', roundId: live.id })}>
              <Flag /> Resume round at {live.courseName}
            </button>
          ) : (
            <button className="btn primary block" onClick={() => go({ name: 'setup' })}>
              <Flag /> Start a round
            </button>
          )}
        </section>

        <div className="grid2">
          {[
            { icon: <MapIcon />, label: 'Courses', sub: 'Find & map courses', to: { name: 'courses' } as const },
            { icon: <Trophy />, label: 'Leaderboards', sub: 'Comps & tables', to: { name: 'leaderboards' } as const },
            { icon: <Users />, label: 'Friends', sub: 'Your crew', to: { name: 'friends' } as const },
            { icon: <Video />, label: 'Shot tracer', sub: 'Sim & video', to: { name: 'tracer' } as const },
            { icon: <ChartColumn />, label: 'My stats', sub: 'Trends & clubs', to: { name: 'stats' } as const },
            { icon: <SettingsIcon />, label: 'Settings', sub: 'Profile & app', to: { name: 'settings' } as const },
          ].map((t) => (
            <button key={t.label} className="tile" onClick={() => go(t.to)}>
              <span className="tile-icon">{t.icon}</span>
              <span>
                {t.label}
                <small>{t.sub}</small>
              </span>
            </button>
          ))}
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
                      {me?.played ? <span className="score-pill">You: {me.rank}{ordinal(me.rank)}</span> : <ChevronRight className="muted" />}
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
