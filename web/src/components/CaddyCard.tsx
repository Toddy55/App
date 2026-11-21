import { useState } from 'react';
import { Sparkles, Send, Target } from 'lucide-react';
import type { Advice } from '../lib/caddy';
import { Card } from './ui';

/** The caddy's call for this shot, plus "Ask the caddy" (Claude) when a key is set. */
export function CaddyCard({
  advice,
  planning,
  apiKey,
  context,
  showOnMap,
  onToggleMap,
  units,
}: {
  advice: Advice;
  planning: boolean;
  apiKey?: string;
  context: () => unknown;
  showOnMap: boolean;
  onToggleMap: () => void;
  units: 'm' | 'yd';
}) {
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fmt = (m: number) => `${Math.round(units === 'yd' ? m * 1.0936 : m)}${units}`;

  const ask = async (question: string) => {
    if (!apiKey || !question.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const { askCaddy } = await import('../lib/aiCaddy');
      setAnswer(await askCaddy(apiKey, context(), question.trim()));
    } catch (e) {
      const { describeAiError } = await import('../lib/aiCaddy');
      setErr(describeAiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="caddy">
      <div className="row between">
        <span className="caddy-badge">
          <Sparkles /> Caddy
        </span>
        <span className="muted small">
          {advice.mode === 'tee' ? 'Off the tee' : 'Into the green'}
          {planning ? ' · planning from the tee' : ''} · {fmt(advice.toPin)} to pin
        </span>
      </div>
      <div className="caddy-call">
        <div className="caddy-club">{advice.headline}</div>
        <div className="caddy-aim">{advice.aimText}</div>
      </div>
      <div className="caddy-meta">
        <span className="chip-stat">Plays {fmt(advice.playsLike)}</span>
        {advice.trouble.map((t) => (
          <span key={t.kind} className={`chip-stat ${t.kind}`}>
            {t.kind === 'water' ? 'Water' : 'Sand'} {t.pct}%
          </span>
        ))}
        <button className={`chip-stat as-btn ${showOnMap ? 'on' : ''}`} onClick={onToggleMap}>
          <Target /> {showOnMap ? 'On map' : 'Show on map'}
        </button>
      </div>
      <ul className="caddy-why">
        {advice.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {apiKey ? (
        <>
          {answer && <p className="caddy-answer">{answer}</p>}
          {err && <p className="error small">{err}</p>}
          <div className="row gap wrap">
            {['Should I go for it?', 'What if I miss it?', 'Safer play?'].map((s) => (
              <button key={s} className="chip" disabled={busy} onClick={() => ask(s)}>
                {s}
              </button>
            ))}
          </div>
          <form
            className="row gap"
            onSubmit={(e) => {
              e.preventDefault();
              ask(q);
            }}
          >
            <input className="grow" placeholder="Ask the caddy…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="icon-btn" disabled={busy || !q.trim()} aria-label="Ask">
              <Send />
            </button>
          </form>
          {busy && <p className="muted small">Thinking…</p>}
        </>
      ) : (
        <p className="muted small">Add your Anthropic key in Settings to chat with the caddy about the shot.</p>
      )}
    </Card>
  );
}
