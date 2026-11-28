import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { Player } from '../types';
import { appHandicap, type AppHandicap } from '../lib/appHandicap';
import { store } from '../lib/storage';
import { Segmented } from './ui';

/** Golf Australia's public handicap page for a GA (GOLF Link) number. */
export const gaHandicapUrl = (n: string) => `https://www.golf.org.au/handicap/${n.replace(/\D/g, '')}`;

/** GA Handicaps change after every round, so nudge after a week. */
export const STALE_MS = 7 * 24 * 3600 * 1000;

export function handicapLabel(p: Player): string {
  const h = p.gaHandicap < 0 ? `+${Math.abs(p.gaHandicap)}` : String(p.gaHandicap);
  return p.hcpSource === 'manual' ? `${h} (manual)` : p.hcpSource === 'app' ? `${h} (app)` : p.gaNumber ? `GA ${h}` : `Hcp ${h}`;
}

/**
 * Read a typed handicap: "11.4", "11,4", "+2.1" (plus handicaps are stored as negatives).
 * Null while it's half typed ("11.", "+") or out of range.
 */
export function parseHcp(text: string): number | null {
  const v = text.trim().replace(',', '.');
  if (!/^[+-]?(\d{1,2}(\.\d?)?|\.\d)$/.test(v) || /\.$/.test(v)) return null;
  const n = v.startsWith('+') ? -Number(v.slice(1)) : Number(v);
  return Number.isFinite(n) && n >= -10 && n <= 54 ? Math.round(n * 10) / 10 : null;
}

/**
 * Official GA Handicap (with GA number and a one-tap check on Golf Australia)
 * or a manual handicap for mates who don't have one.
 */
export function HandicapEditor({ player, onChange }: { player: Player; onChange: (p: Player) => void }) {
  const source = player.hcpSource ?? 'ga';
  const digits = (player.gaNumber ?? '').replace(/\D/g, '');
  const validNo = digits.length === 10;
  const stale = source === 'ga' && validNo && (!player.hcpCheckedAt || Date.now() - player.hcpCheckedAt > STALE_MS);
  const set = (p: Partial<Player>) => onChange({ ...player, ...p });
  // Keep what's typed (e.g. "+" on the way to "+2.1"); plus handicaps are stored as negatives
  const show = (h: number) => (h < 0 ? `+${Math.abs(h)}` : String(h));
  const [text, setText] = useState(show(player.gaHandicap));
  // Worked out from the rounds scored in the app
  const [app] = useState<AppHandicap>(() => appHandicap(player.id, store.rounds(), store.courses()));
  const hcpInput = (
    <input
      inputMode="text"
      placeholder="e.g. 11.4"
      value={text}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d.,+-]/g, '');
        setText(t);
        // Only save a finished number, so "11." keeps its dot while you type the 4
        const n = parseHcp(t);
        if (n != null) set({ gaHandicap: n, hcpCheckedAt: source === 'ga' ? Date.now() : player.hcpCheckedAt });
      }}
      onBlur={() => setText(show(player.gaHandicap))}
    />
  );

  return (
    <div className="hcp-editor">
      <Segmented
        value={source}
        onChange={(v) => {
          // Switching to "from my rounds" picks up the worked-out number straight away
          if (v === 'app' && app.index != null) {
            set({ hcpSource: v, gaHandicap: app.index, hcpCheckedAt: Date.now() });
            setText(show(app.index));
          } else set({ hcpSource: v });
        }}
        options={[
          { value: 'ga', label: 'GA Handicap' },
          { value: 'app', label: 'From my rounds' },
          { value: 'manual', label: 'Agreed' },
        ]}
      />
      {source === 'app' ? (
        <AppHcp app={app} hcpInput={hcpInput} />
      ) : source === 'ga' ? (
        <>
          <label className="field">
            <span>GA number (10 digits, on the Golf Australia app or your club card)</span>
            <input
              inputMode="numeric"
              autoComplete="off"
              placeholder="e.g. 3012400898"
              value={player.gaNumber ?? ''}
              maxLength={13}
              onChange={(e) => set({ gaNumber: e.target.value.replace(/[^\d ]/g, '') || undefined })}
            />
          </label>
          {validNo && (
            <a className="btn block" href={gaHandicapUrl(digits)} target="_blank" rel="noreferrer">
              <ExternalLink /> Check it on Golf Australia
            </a>
          )}
          {digits.length > 0 && !validNo && <p className="warn small">A GA number has 10 digits ({digits.length} so far).</p>}
          <label className="field narrow">
            <span>GA Handicap</span>
            {hcpInput}
          </label>
          <p className="muted small">
            {validNo
              ? stale
                ? '⏰ Not checked in the last week. Tap the button above and copy the GA Handicap from Golf Australia, so the daily handicap is spot on.'
                : `Checked ${player.hcpCheckedAt ? new Date(player.hcpCheckedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''}. GA Handicaps change after every round, so check before a comp.`
              : 'Put in the GA number and you can check the official handicap in one tap. Plus handicaps: type +2.1.'}
          </p>
          {app.index != null && (
            <p className="muted small">
              📈 Your rounds in Shotmate work out to <strong>{show(app.index)}</strong> ({app.rounds.length} round{app.rounds.length === 1 ? '' : 's'}). Pick "From my rounds" to use that instead.
            </p>
          )}
        </>
      ) : (
        <>
          <label className="field narrow">
            <span>Handicap (agreed with the group)</span>
            {hcpInput}
          </label>
          <p className="muted small">A number the group agrees on, for mates without a GA handicap. It works the same in every format and comp, and shows as "manual" so everyone knows it's not official.</p>
        </>
      )}
    </div>
  );
}

/** The handicap worked out from rounds in the app, and the rounds behind it. */
function AppHcp({ app, hcpInput }: { app: AppHandicap; hcpInput: React.ReactNode }) {
  const show = (h: number) => (h < 0 ? `+${Math.abs(h)}` : h.toFixed(1));
  const n = Math.min(20, app.rounds.length);
  const last20 = app.rounds.slice(0, 20);
  const est = last20.some((r) => r.estimatedRatings);
  return (
    <>
      {app.index != null ? (
        <div className="app-hcp">
          <div className="app-hcp-big">{show(app.index)}</div>
          <div className="small">
            Best {app.counting} of your last {n} round{n === 1 ? '' : 's'}
            {app.adjustment ? ` (${app.adjustment} while there are only ${n})` : ''}. Updates after every round you finish.
          </div>
        </div>
      ) : (
        <>
          <p className="small">
            It needs <strong>3 rounds</strong> finished in the app ({app.rounds.length} so far). Until then it uses this:
          </p>
          <label className="field narrow">
            <span>Starting handicap</span>
            {hcpInput}
          </label>
        </>
      )}
      {last20.length > 0 && (
        <details className="app-hcp-rounds">
          <summary>The rounds behind it</summary>
          <table className="totals">
            <thead>
              <tr>
                <th>Date</th>
                <th>Course</th>
                <th>Score</th>
                <th>Diff</th>
              </tr>
            </thead>
            <tbody>
              {last20.map((r) => (
                <tr key={r.roundId} className={r.used ? 'counts' : ''}>
                  <td>{new Date(r.at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</td>
                  <td>
                    {r.courseName}
                    {r.holes <= 9 ? ' (9)' : ''}
                  </td>
                  <td>
                    {r.adjusted}
                    {r.adjusted !== r.gross ? <small className="muted"> ({r.gross})</small> : null}
                  </td>
                  <td>
                    {r.diff.toFixed(1)}
                    {r.used ? ' ✓' : ''}
                    {r.estimatedRatings ? '*' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            ✓ = counts. Score is capped at net double bogey per hole (actual in brackets). Diff = (113 ÷ slope) × (score − scratch rating); a 9-hole round adds the expected score for the other 9.
            {est ? ' * No slope/scratch for that tee yet, so it used slope 113 and scratch = par: add the ratings in the course\'s Tees card.' : ''}
          </p>
        </details>
      )}
      <p className="muted small">
        Worked out the World Handicap System way (best 8 of the last 20, net double bogey, slope and scratch from the tee you played). It only sees rounds in Shotmate, so it's not an official GA Handicap.
      </p>
    </>
  );
}
