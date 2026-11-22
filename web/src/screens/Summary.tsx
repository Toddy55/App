import { useState } from 'react';
import type { Round } from '../types';
import { store } from '../lib/storage';
import { coach, toPar } from '../lib/analysis';
import { computeResult, FORMAT_LABELS } from '../lib/scoring';
import { Scorecard } from '../components/Scorecard';
import { Markdown } from '../components/Markdown';
import { ShotReplay } from '../components/ShotReplay';
import { ShotPatterns } from '../components/ShotPatterns';
import { Card, Header, type Go } from '../components/ui';
import { encodeBundle, makeBundle, shareLink, shareUrl } from '../lib/share';

export function Summary({ go, roundId }: { go: Go; roundId: string }) {
  const [round, setRound] = useState<Round | undefined>(() => store.round(roundId));
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const settings = store.settings();

  if (!round) {
    return (
      <div className="screen">
        <Header title="Round" onBack={() => go({ name: 'home' })} />
        <p className="content">Round not found.</p>
      </div>
    );
  }

  const result = computeResult(round);
  // Coach against the handicap of whoever "me" is (team handicap × 2 roughly maps Ambrose to an individual band).
  const myPlayer = round.players.find((p) => p.id === round.meId);
  const team = round.teams?.find((t) => t.id === round.meId);
  const handicap = myPlayer?.dailyHandicap ?? (team ? team.handicap : settings.me.gaHandicap);
  const c = coach(round, handicap);
  const s = c.stats;

  const comps = store.comps();
  const toggleComp = (id: string) => {
    const ids = round.compIds ?? [];
    const next = { ...round, compIds: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] };
    store.saveRound(next);
    setRound(next);
  };
  const shareRound = async () => {
    try {
      const b = makeBundle({ me: settings.me, friends: store.friends(), rounds: [round], comps: comps.filter((c) => round.compIds?.includes(c.id)) });
      const how = await shareLink(`${round.courseName} round`, `${result.headline} at ${round.courseName}. Tap to add the round to your Fairway Coach:`, shareUrl(await encodeBundle(b)));
      setShareMsg(how === 'copied' ? 'Link copied. Paste it in the group chat.' : null);
    } catch (e) {
      setShareMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const runAi = async () => {
    if (!settings.anthropicKey) {
      setAiErr('Add your Anthropic API key in Settings to use the AI coach.');
      return;
    }
    setAiBusy(true);
    setAiErr(null);
    try {
      const { aiCoachReport } = await import('../lib/aiCoach');
      const text = await aiCoachReport(settings.anthropicKey, round, c);
      const next = { ...round, aiReport: text };
      store.saveRound(next);
      setRound(next);
    } catch (e) {
      const { describeAiError } = await import('../lib/aiCoach');
      setAiErr(describeAiError(e));
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="screen">
      <Header title="Round review" onBack={() => go({ name: 'home' })} />
      <div className="content">
        <Card>
          <div className="eyebrow">
            {round.courseName} · {new Date(round.date).toLocaleDateString('en-AU')} · {FORMAT_LABELS[round.format]}
          </div>
          <h2 className="result">{result.headline}</h2>
          <div className="kpis">
            <Kpi label="Score" value={`${s.gross}`} sub={toPar(s.toPar)} />
            <Kpi label="Putts" value={s.puttsRecorded ? `${s.putts}` : '–'} sub={s.threePutts ? `${s.threePutts} × 3-putt` : ''} />
            <Kpi label="Fairways" value={s.fairwayChances ? `${s.fairwaysHit}/${s.fairwayChances}` : '–'} sub={s.fairwayChances ? `${s.missLeft}L · ${s.missRight}R` : ''} />
            <Kpi label="GIR" value={s.girKnown ? `${s.gir}/${s.girKnown}` : '–'} />
            <Kpi label="Up & down" value={s.scrambleChances ? `${s.scrambles}/${s.scrambleChances}` : '–'} />
            <Kpi label="Penalties" value={`${s.penalties}`} />
          </div>
          {!round.completed && (
            <button className="btn" onClick={() => go({ name: 'play', roundId: round.id })}>
              Back to round
            </button>
          )}
        </Card>

        <Card title="👥 Share & comps">
          <button className="btn primary" onClick={shareRound}>
            🔗 Share round with the group
          </button>
          {shareMsg && <p className="ok small">{shareMsg}</p>}
          {round.sharedBy && <p className="muted small">Shared to you by {round.sharedBy}.</p>}
          {round.liveCode && round.liveGroup && (
            <button className="btn" onClick={() => go({ name: 'live', code: round.liveCode! })}>
              📡 See the whole field &amp; save the combined round
            </button>
          )}
          {comps.length > 0 && (
            <>
              <p className="muted small">Counts towards:</p>
              <div className="row gap wrap">
                {comps.map((c) => {
                  const on = round.compIds?.includes(c.id);
                  return (
                    <button key={c.id} className={`chip ${on ? 'on' : ''}`} onClick={() => toggleComp(c.id)}>
                      {on ? '🏆 ' : ''}
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </Card>

        <Card title="🧠 Your coach" className="coach">
          <p>{c.summary}</p>
          {c.focus.length > 0 && (
            <>
              <h3>Areas to focus on</h3>
              {c.focus.slice(0, 4).map((f) => (
                <div key={f.id} className="focus">
                  <div className="row between">
                    <strong>{f.title}</strong>
                    <span className="strokes">≈{f.strokes} shots</span>
                  </div>
                  <p>{f.detail}</p>
                  <p>
                    <span className="tag">Drill</span> {f.drill}
                  </p>
                  <p>
                    <span className="tag alt">On course</span> {f.onCourse}
                  </p>
                </div>
              ))}
            </>
          )}
          {c.costliest.length > 0 && (
            <>
              <h3>Costliest holes</h3>
              <ul>
                {c.costliest.map((h) => (
                  <li key={h.number}>
                    <strong>
                      Hole {h.number} (par {h.par}): {h.gross}
                    </strong>{' '}
                    · {h.reasons.join(', ')}
                  </li>
                ))}
              </ul>
            </>
          )}
          {c.positives.length > 0 && (
            <>
              <h3>What went well</h3>
              <ul>
                {c.positives.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </>
          )}
          <h3>This week's practice plan</h3>
          <ol>
            {c.practicePlan.map((p, i) => (
              <li key={i}>
                <strong>{p.minutes} min</strong>: {p.what}
              </li>
            ))}
          </ol>
          <p className="muted small">
            Compared with typical numbers for a {Math.round(handicap)} handicapper: ~{Math.round(c.benchmark.putts)} putts, ~{Math.round(c.benchmark.gir)} GIR,{' '}
            {Math.round(c.benchmark.fir * 100)}% fairways per 18. The more stats you log, the sharper this gets.
          </p>
        </Card>

        <Card title="✨ AI coach (deeper read)">
          {round.aiReport ? (
            <Markdown text={round.aiReport} />
          ) : (
            <p className="muted">Get a personalised write-up from Claude based on every hole of this round.</p>
          )}
          {aiErr && <p className="error">{aiErr}</p>}
          <button className="btn primary" disabled={aiBusy} onClick={runAi}>
            {aiBusy ? 'Analysing your round…' : round.aiReport ? 'Re-analyse' : 'Analyse my round'}
          </button>
          {!settings.anthropicKey && (
            <button className="btn ghost small" onClick={() => go({ name: 'settings' })}>
              Add API key
            </button>
          )}
        </Card>

        <ShotReplay round={round} units={settings.units} />
        <ShotPatterns rounds={[round]} />

        <Card title="Scorecard">
          <Scorecard round={round} />
        </Card>

        <div className="row between">
          {round.completed && (
            <button className="btn ghost" onClick={() => { const r = { ...round, completed: false }; store.saveRound(r); go({ name: 'play', roundId: r.id }); }}>
              Edit scores
            </button>
          )}
          <button
            className="btn danger ghost"
            onClick={() => {
              if (confirm('Delete this round?')) {
                store.deleteRound(round.id);
                go({ name: 'home' });
              }
            }}
          >
            Delete round
          </button>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub ? <div className="kpi-sub">{sub}</div> : null}
    </div>
  );
}
