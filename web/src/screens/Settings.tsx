import { useState } from 'react';
import type { Settings as S } from '../types';
import { DEFAULT_CLUBS, store } from '../lib/storage';
import { Card, Header, Segmented, type Go } from '../components/ui';
import { readAppearance, saveAppearance, type Accent, type Mode } from '../lib/appearance';

export function Settings({ go }: { go: Go }) {
  const [s, setS] = useState<S>(store.settings());
  const save = (n: S) => {
    setS(n);
    store.saveSettings(n);
  };
  const [clubsText, setClubsText] = useState(s.clubs.join(', '));
  const [look, setLook] = useState(readAppearance());
  const setAccent = (accent: Accent) => {
    const n = { ...look, accent };
    setLook(n);
    saveAppearance(n);
  };
  const setMode = (mode: Mode) => {
    const n = { ...look, mode };
    setLook(n);
    saveAppearance(n);
  };

  return (
    <div className="screen">
      <Header title="Settings" onBack={() => go({ name: 'home' })} />
      <div className="content">
        <Card title="You">
          <label className="field">
            <span>Name</span>
            <input value={s.me.name} onChange={(e) => save({ ...s, me: { ...s.me, name: e.target.value } })} />
          </label>
          <label className="field narrow">
            <span>GA Handicap</span>
            <input
              inputMode="decimal"
              value={String(s.me.gaHandicap)}
              onChange={(e) => save({ ...s, me: { ...s.me, gaHandicap: Number(e.target.value) || 0 } })}
            />
          </label>
          <p className="muted small">Use your current GA Handicap from the Golf Australia app. Enter plus handicaps as a negative number (e.g. −1.2).</p>
        </Card>
        <Card title="Look">
          <div className="field">
            <span>Purple with…</span>
            <div className="row gap">
              {(
                [
                  ['blue', 'Electric blue', '#2bc4ff'],
                  ['mint', 'Mint', '#2ee6a6'],
                  ['gold', 'Gold', '#f2b705'],
                ] as const
              ).map(([k, label, colour]) => (
                <button key={k} className={`accent-pick ${look.accent === k ? 'on' : ''}`} onClick={() => setAccent(k)} aria-label={label}>
                  <span className="accent-swatch" style={{ background: `linear-gradient(135deg, #3b22a0 50%, ${colour} 50%)` }} />
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>Mode</span>
            <Segmented value={look.mode} onChange={setMode} options={[{ value: 'auto', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
          </div>
        </Card>
        <Card title="Distances">
          <Segmented value={s.units} onChange={(u) => save({ ...s, units: u })} options={[{ value: 'm', label: 'Metres' }, { value: 'yd', label: 'Yards' }]} />
        </Card>
        <Card title="My bag">
          <textarea rows={3} value={clubsText} onChange={(e) => setClubsText(e.target.value)} onBlur={() => save({ ...s, clubs: clubsText.split(',').map((c) => c.trim()).filter(Boolean) })} />
          <button className="btn ghost small" onClick={() => { setClubsText(DEFAULT_CLUBS.join(', ')); save({ ...s, clubs: DEFAULT_CLUBS }); }}>
            Reset to default
          </button>
        </Card>
        <Card title="AI coach">
          <label className="field">
            <span>Anthropic API key</span>
            <input type="password" autoComplete="off" placeholder="sk-ant-…" value={s.anthropicKey ?? ''} onChange={(e) => save({ ...s, anthropicKey: e.target.value.trim() || undefined })} />
          </label>
          <p className="muted small">
            Optional. Unlocks the deeper Claude write-up after each round. The built-in coach works without it. The key is stored only on this phone and sent only to Anthropic. Get one at console.anthropic.com.
          </p>
        </Card>
        <Card title="Your data">
          <p className="muted small">Rounds and courses are saved on this device. Export a backup now and then.</p>
          <div className="row gap">
            <button
              className="btn"
              onClick={() => {
                const blob = new Blob([JSON.stringify({ rounds: store.rounds(), courses: store.courses(), friends: store.friends() }, null, 1)], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `fairway-coach-backup-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
              }}
            >
              Export backup
            </button>
            <label className="btn">
              Import
              <input
                type="file"
                accept="application/json"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    const j = JSON.parse(await f.text());
                    (j.courses ?? []).forEach(store.saveCourse);
                    (j.rounds ?? []).forEach(store.saveRound);
                    if (j.friends) store.saveFriends(j.friends);
                    alert('Backup imported.');
                  } catch {
                    alert('That file could not be read.');
                  }
                }}
              />
            </label>
          </div>
        </Card>
      </div>
    </div>
  );
}
