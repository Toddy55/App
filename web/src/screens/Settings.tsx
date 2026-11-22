import { useState } from 'react';
import type { Settings as S } from '../types';
import { DEFAULT_CLUBS, store } from '../lib/storage';
import { HandicapEditor } from '../components/HandicapEditor';
import { NotifyToggle } from '../components/NotifyToggle';
import { SyncCard } from '../components/SyncCard';
import { Card, Header, Segmented, type Go } from '../components/ui';
import { HOME_BGS, readHomeBg, readOwnBg, saveHomeBg, saveOwnBg } from '../lib/homeBg';
import { PALETTES, readAppearance, saveAppearance, type Palette } from '../lib/appearance';

export function Settings({ go }: { go: Go }) {
  const [s, setS] = useState<S>(store.settings());
  const save = (n: S) => {
    setS(n);
    store.saveSettings(n);
    window.dispatchEvent(new Event('gtg:me'));
  };
  const [clubsText, setClubsText] = useState(s.clubs.join(', '));
  const [look, setLook] = useState(readAppearance());
  const setPalette = (palette: Palette) => {
    const n = { ...look, palette };
    setLook(n);
    saveAppearance(n);
  };

  const [bg, setBg] = useState(readHomeBg);
  const [bgErr, setBgErr] = useState<string | null>(null);
  const pickBg = (id: string) => {
    setBgErr(null);
    setBg(id);
    saveHomeBg(id);
  };
  const [ownBg, setOwnBg] = useState(readOwnBg);
  const uploadBg = async (f: File | undefined) => {
    if (!f) return;
    setBgErr(null);
    try {
      await saveOwnBg(f);
      setOwnBg(readOwnBg());
      setBg('own');
    } catch (e) {
      setBgErr(e instanceof Error ? e.message : String(e));
    }
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
          <HandicapEditor player={s.me} onChange={(me) => save({ ...s, me })} />
        </Card>
        <SyncCard />
        <Card title="Live rounds">
          <label className="check">
            <input type="checkbox" checked={s.shareLive !== false} onChange={(e) => save({ ...s, shareLive: e.target.checked })} />
            <span>
              <strong>Share my rounds live with my friends</strong>
              <span className="muted small"> Your mates see you're playing on their Home screen and can watch your scores and shot cam. No link needed.</span>
            </span>
          </label>
          <NotifyToggle />
        </Card>
        <Card title="Look">
          <div className="field">
            <span>Colours</span>
            <div className="palette-grid">
              {PALETTES.map((p) => (
                <button key={p.id} className={`accent-pick ${look.palette === p.id ? 'on' : ''}`} onClick={() => setPalette(p.id)} aria-label={p.label}>
                  <span className="accent-swatch" style={{ background: `linear-gradient(135deg, ${p.brand} 50%, ${p.accent} 50%)` }} />
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>Background photo (every screen)</span>
            <div className="bg-grid">
              {HOME_BGS.map((b) => (
                <button key={b.id} className={`bg-pick ${bg === b.id ? 'on' : ''}`} style={{ backgroundImage: `url("${import.meta.env.BASE_URL}bg/${b.file}")` }} onClick={() => pickBg(b.id)}>
                  <span>{b.label}</span>
                </button>
              ))}
              <label className={`bg-pick ${ownBg ? '' : 'plain'} ${bg === 'own' ? 'on' : ''}`} style={ownBg ? { backgroundImage: `url("${ownBg}")` } : undefined}>
                <input type="file" accept="image/*" onChange={(e) => uploadBg(e.target.files?.[0])} />
                <span>{ownBg ? 'My photo (tap to change)' : '📷 Use my own photo'}</span>
              </label>
              <button className={`bg-pick plain ${bg === 'none' ? 'on' : ''}`} onClick={() => pickBg('none')}>
                <span>No photo</span>
              </button>
            </div>
            {ownBg && bg !== 'own' && (
              <button className="btn small" onClick={() => pickBg('own')}>
                Use my photo
              </button>
            )}
            {bgErr && <p className="error">{bgErr}</p>}
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
          <details className="my-distances" open={!!s.myDistances && Object.keys(s.myDistances).length > 0}>
            <summary>
              <strong>My distances</strong> <span className="muted small">(so the caddie uses your numbers)</span>
            </summary>
            <p className="muted small">How far a normal <strong>full swing</strong> goes with each club in total, carry plus roll, on a calm day. For wedges, that's your full shot, not chips or pitches around the green. Leave a club blank and the caddie uses your tracked shots, or typical numbers for your handicap.</p>
            <div className="dist-grid">
              {s.clubs
                .filter((c) => !/putt/i.test(c))
                .map((c) => {
                  const m = s.myDistances?.[c];
                  const shown = m ? Math.round(s.units === 'yd' ? m * 1.0936 : m) : '';
                  return (
                    <label key={c} className="dist-row">
                      <span>{c}</span>
                      <input
                        inputMode="numeric"
                        placeholder={s.units}
                        defaultValue={shown}
                        onBlur={(e) => {
                          const v = Number(e.target.value.replace(/[^\d.]/g, ''));
                          const next = { ...(s.myDistances ?? {}) };
                          if (v > 0) next[c] = Math.round((s.units === 'yd' ? v / 1.0936 : v) * 10) / 10;
                          else delete next[c];
                          save({ ...s, myDistances: next });
                        }}
                      />
                    </label>
                  );
                })}
            </div>
          </details>
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
