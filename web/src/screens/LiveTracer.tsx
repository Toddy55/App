import { useEffect, useRef, useState } from 'react';
import { BallTracker, diffBlobs, findBallAtAddress, StrikeDetector, toGray, type Flight } from '../lib/balltrack';
import { cameraPitchFromOrientation, makeCamera, project, type Camera, type Obs, type ShotResult } from '../lib/ballflight';
import { calibrateInBackground, fitInBackground } from '../lib/fitClient';
import { drawTracer, type Pt } from '../lib/tracer';
import { handOff, type TraceHandoff } from '../lib/traceHandoff';
import { store } from '../lib/storage';
import { Card, Header, Segmented, type Go } from '../components/ui';

type Phase = 'idle' | 'aim' | 'armed' | 'flying';

const COLOUR = '#ff3b30';
// Track at up to 640 px wide: the ball is a speck within a fraction of a second, so detail matters
const DETECT_W = 640;
const CAL_KEY = 'gtg.tracerSpeed';
const HEIGHT_KEY = 'gtg.tracerPhoneHeight';

interface SessionShot {
  n: number;
  club: string;
  result: ShotResult | null;
  handoff: TraceHandoff;
  /** What the camera saw, kept so the shot can be used to calibrate. */
  seen?: { cam: Camera; obs: Obs[] };
}

function readNum(key: string, fallback: number) {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}
function writeNum(key: string, v: number) {
  try {
    localStorage.setItem(key, String(v));
  } catch {
    /* ignore */
  }
}

/**
 * The "sim": phone on the bag behind the golfer. It hears the strike, finds
 * the ball, traces it live, fits a ball flight to what it saw and shows carry,
 * apex, curve and where it landed. Then it re-arms for the next shot.
 */
export function LiveTracer({ go }: { go: Go }) {
  const settings = store.settings();
  const units = settings.units;
  const [phase, setPhase] = useState<Phase>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [mic, setMic] = useState(false);
  const [tilt, setTilt] = useState(false);
  const [ballSeen, setBallSeen] = useState(false);
  const [shots, setShots] = useState<SessionShot[]>([]);
  const [club, setClub] = useState(settings.clubs.find((c) => /7/.test(c)) ?? settings.clubs[0] ?? '');
  const [cal, setCal] = useState(() => readNum(CAL_KEY, 1));
  const [height, setHeight] = useState(() => readNum(HEIGHT_KEY, 1.0));
  const [actual, setActual] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const r = useRef({
    stream: null as MediaStream | null,
    tracker: null as BallTracker | null,
    tapLaunch: null as Pt | null,
    prev: null as Uint8Array | null,
    small: null as HTMLCanvasElement | null,
    analyser: null as AnalyserNode | null,
    audioCtx: null as AudioContext | null,
    strike: new StrikeDetector(),
    rec: null as MediaRecorder | null,
    chunks: [] as Blob[],
    recStart: 0,
    mime: '',
    phase: 'idle' as Phase,
    flight: null as Flight | null,
    result: null as ShotResult | null,
    seen: null as { cam: Camera; obs: Obs[] } | null,
    shown: null as { pts: (Pt & { t: number })[]; until: number } | null,
    finishing: false,
    stopLoop: false,
    orient: null as { beta: number; gamma: number } | null,
    frame: 0,
    hintVotes: [] as Pt[],
    club: '',
    cal: 1,
    height: 1,
    shotN: 0,
    diag: { maxPeak: 0, strikes: [] as number[], frames: 0, blobsLast: 0 },
  });
  r.current.phase = phase;
  r.current.club = club;
  r.current.cal = cal;
  r.current.height = height;
  (window as unknown as { __liveTracer?: unknown }).__liveTracer = r.current;

  useEffect(
    () => () => {
      const s = r.current;
      s.stopLoop = true;
      if (s.rec && s.rec.state !== 'inactive') s.rec.stop();
      s.stream?.getTracks().forEach((t) => t.stop());
      s.audioCtx?.close().catch(() => {});
      window.removeEventListener('deviceorientation', onOrient);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function onOrient(e: DeviceOrientationEvent) {
    if (e.beta == null || e.gamma == null) return;
    r.current.orient = { beta: e.beta, gamma: e.gamma };
    setTilt(true);
  }

  const startCamera = async () => {
    setErr(null);
    const s = r.current;
    // Tilt sensor (iPhone asks permission, and only from a tap)
    try {
      const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
      if (DOE.requestPermission) await DOE.requestPermission().catch(() => 'denied');
      window.addEventListener('deviceorientation', onOrient);
    } catch {
      /* no tilt sensor */
    }
    const videoC: MediaTrackConstraints = { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } };
    try {
      try {
        // Noise suppression would filter out the very "tick" we're listening for
        s.stream = await navigator.mediaDevices.getUserMedia({
          video: videoC,
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      } catch {
        s.stream = await navigator.mediaDevices.getUserMedia({ video: videoC, audio: false });
      }
    } catch (e) {
      setErr(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'Camera access was blocked. On iPhone: Settings → Safari → Camera → Allow, then try again.'
          : `Couldn't start the camera: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    const v = video.current!;
    v.srcObject = s.stream;
    v.muted = true;
    v.play().catch(() => {});
    if (s.stream.getAudioTracks().length > 0) {
      try {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        s.audioCtx = new AC();
        const an = s.audioCtx.createAnalyser();
        an.fftSize = 1024;
        s.audioCtx.createMediaStreamSource(s.stream).connect(an);
        s.analyser = an;
        setMic(true);
      } catch {
        setMic(false);
      }
    }
    const types = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    s.mime = typeof MediaRecorder !== 'undefined' ? (types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '') : '';
    // With a microphone it's fully automatic; without one, the ball has to be tapped
    if (s.analyser) {
      const wait = () => (v.videoWidth ? arm(null) : setTimeout(wait, 100));
      setPhase('armed');
      wait();
    } else setPhase('aim');
    loop();
  };

  const startRecording = () => {
    const s = r.current;
    if (!s.stream || !s.mime) return;
    const chunks: Blob[] = [];
    s.chunks = chunks;
    s.rec = new MediaRecorder(s.stream, { mimeType: s.mime, videoBitsPerSecond: 8_000_000 });
    s.rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    s.rec.start(500);
    s.recStart = performance.now() / 1000;
  };

  const arm = (launch: Pt | null) => {
    const s = r.current;
    const v = video.current!;
    const dw = Math.min(DETECT_W, v.videoWidth);
    const dh = Math.round((v.videoHeight / v.videoWidth) * dw);
    s.tapLaunch = launch;
    s.tracker = new BallTracker(launch, dw, dh, !!s.analyser);
    s.prev = null;
    s.flight = null;
    s.result = null;
    s.seen = null;
    s.shown = null;
    s.finishing = false;
    s.hintVotes = [];
    setBallSeen(!!launch);
    if (s.rec && s.rec.state !== 'inactive') s.rec.stop();
    startRecording();
    setPhase('armed');
  };

  /** Fit the physics to what we saw and work out the whole flight on screen. */
  const solve = async (tr: BallTracker, f: Flight, vw: number) => {
    const s = r.current;
    const pitch = s.orient ? cameraPitchFromOrientation(s.orient.beta, s.orient.gamma) : 0;
    const origin = tr.launch ?? f.at(f.t0);
    const cam = makeCamera(tr.w, tr.h, pitch, origin, undefined, s.height);
    const obs = f.tracked.slice(1).map((p) => ({ t: p.t - f.t0, x: p.x, y: p.y }));
    s.seen = { cam, obs };
    const res = await fitInBackground(cam, obs, s.club, s.cal);
    (s.diag as Record<string, unknown>).lastSolve = { n: obs.length, error: res?.error, carry: res?.carry, pitch, origin, cam, obs: obs.slice(0, 60) };
    if (!res || res.error > 25) return null;
    const k = vw / tr.w;
    const pts = res.path
      .filter((_, i) => i % 4 === 0 || i === res.path.length - 1)
      .map((q) => {
        const p = project(cam, q);
        return { x: p.x * k, y: p.y * k, t: f.t0 + q.t };
      });
    return { res, pts };
  };

  const finish = async () => {
    const s = r.current;
    const f = s.flight;
    const v = video.current!;
    const tr = s.tracker!;
    const rec = s.rec;
    const chunks = s.chunks;
    if (!rec || !f) return;
    if (rec.state !== 'inactive') {
      await new Promise<void>((res) => {
        rec.onstop = () => res();
        rec.stop();
      });
    }
    const type = s.mime.split(';')[0];
    const file = new File([new Blob(chunks, { type })], `shot-tracer.${type.includes('mp4') ? 'mp4' : 'webm'}`, { type });
    const rel = (t: number) => Math.max(0, t - s.recStart);
    const k = v.videoWidth / tr.w;
    const res = s.result;
    let handoff: TraceHandoff;
    if (res && s.shown) {
      const pts = s.shown.pts;
      const top = pts.reduce((a, b) => (b.y < a.y ? b : a));
      const last = pts[pts.length - 1];
      const d = (m: number) => `${Math.round(units === 'yd' ? m * 1.0936 : m)} ${units}`;
      handoff = {
        file,
        start: { x: pts[0].x, y: pts[0].y, t: rel(pts[0].t) },
        end: { x: last.x, y: last.y, t: rel(last.t) },
        apex: { x: top.x, y: top.y },
        path: pts.map((p) => ({ x: p.x, y: p.y, t: rel(p.t) })),
        info: [
          `${s.club ? s.club + ' · ' : ''}Carry ${d(res.carry)}`,
          `Apex ${d(res.apex)} · Hang ${res.hang.toFixed(1)}s`,
          `${res.shape} · ${Math.abs(res.lateral) < 2 ? 'on line' : `${d(Math.abs(res.lateral))} ${res.lateral > 0 ? 'right' : 'left'}`}`,
        ],
      };
    } else {
      const P = (p: Pt) => ({ x: p.x * k, y: p.y * k });
      handoff = { file, start: { ...P(f.at(f.t0)), t: rel(f.t0) }, end: { ...P(f.at(f.tEnd)), t: rel(f.tEnd) }, apex: P(f.at(f.tApex)) };
    }
    s.shotN++;
    const n = s.shotN;
    const clubNow = s.club;
    const seen = s.seen ?? undefined;
    setShots((prev) => [{ n, club: clubNow, result: res, handoff, seen }, ...prev].slice(0, 30));
    // Straight back to ready for the next one
    arm(s.tapLaunch);
  };

  type FrameMeta = { captureTime?: number; expectedDisplayTime?: number; mediaTime?: number };
  const loop = (now?: number, meta?: FrameMeta) => {
    const s = r.current;
    const v = video.current;
    const c = canvas.current;
    if (s.stopLoop || !v || !c) return;
    const next = () => {
      const rv = v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: FrameMeta) => void) => number };
      if (rv.requestVideoFrameCallback) rv.requestVideoFrameCallback((n, m) => loop(n, m));
      else requestAnimationFrame(() => loop());
    };
    if (!v.videoWidth) return next();
    // When the camera actually took this frame (more exact than when our code got to run)
    const t = (meta?.captureTime ?? now ?? performance.now()) / 1000;
    if (c.width !== v.videoWidth) {
      c.width = v.videoWidth;
      c.height = v.videoHeight;
    }
    const ctx = c.getContext('2d')!;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    const tr = s.tracker;
    const lineW = Math.max(4, c.width / 160);

    if (tr && (s.phase === 'armed' || s.phase === 'flying')) {
      if (s.analyser) {
        const buf = new Float32Array(s.analyser.fftSize);
        s.analyser.getFloatTimeDomainData(buf);
        let peak = 0;
        for (const x of buf) peak = Math.max(peak, Math.abs(x));
        s.diag.maxPeak = Math.max(s.diag.maxPeak, peak);
        if (s.strike.feed(peak, t)) {
          s.diag.strikes.push(t);
          tr.strike(t);
        }
      }
      const small = (s.small ??= document.createElement('canvas'));
      if (small.width !== tr.w) {
        small.width = tr.w;
        small.height = tr.h;
      }
      const sctx = small.getContext('2d', { willReadFrequently: true })!;
      sctx.drawImage(v, 0, 0, tr.w, tr.h);
      const cur = new Uint8Array(tr.w * tr.h);
      toGray(sctx.getImageData(0, 0, tr.w, tr.h).data, cur);
      if (s.prev) {
        const blobs = diffBlobs(s.prev, cur, tr.w, tr.h, 22, tr.maxArea * 4);
        s.diag.frames++;
        s.diag.blobsLast = blobs.length;
        tr.feed(blobs, t);
      }
      s.prev = cur;

      // Look for the ball sitting at address (seen twice in the same spot)
      s.frame++;
      if (!tr.launch && tr.state === 'armed' && s.frame % 10 === 0) {
        const b = findBallAtAddress(cur, tr.w, tr.h);
        if (b) {
          s.hintVotes = [...s.hintVotes, b].slice(-3);
          const [a, z] = [s.hintVotes[0], s.hintVotes[s.hintVotes.length - 1]];
          if (s.hintVotes.length >= 2 && Math.hypot(a.x - z.x, a.y - z.y) < 3 * tr.s) {
            tr.hint = z;
            setBallSeen(true);
          }
        }
      }

      const f = tr.flight();
      if (f) {
        s.flight = f;
        if (s.phase === 'armed') setPhase('flying');
        if (tr.state === 'done' && !s.result && !s.finishing) {
          s.finishing = true;
          const tracker = tr;
          // Fit the flight in the background; keep drawing the live line meanwhile
          solve(tr, f, c.width).then((solved) => {
            if (r.current.tracker !== tracker) return;
            if (solved) {
              s.result = solved.res;
              s.shown = { pts: solved.pts, until: solved.pts[solved.pts.length - 1].t };
            }
            const endT = s.shown?.until ?? f.tEnd;
            setTimeout(() => finish(), Math.max(0, endT + 1.2 - performance.now() / 1000) * 1000);
          });
        }
        if (s.shown) {
          const pts = s.shown.pts.filter((p) => p.t <= t);
          if (pts.length > 1) drawTracer(ctx, pts, { color: COLOUR, width: lineW }, t < s.shown.until);
        } else {
          const k = c.width / tr.w;
          const until = Math.min(t, f.tEnd);
          const pts: Pt[] = [];
          for (let i = 0; i <= 60; i++) {
            const p = f.at(f.t0 + ((until - f.t0) * i) / 60);
            pts.push({ x: p.x * k, y: p.y * k });
          }
          drawTracer(ctx, pts, { color: COLOUR, width: lineW }, t < f.tEnd);
        }
      }
      // Nothing hit for a minute: start a fresh recording so clips stay short
      if (t - s.recStart > 60 && s.rec && tr.state === 'armed') {
        s.rec.stop();
        startRecording();
      }
      // Where we think the ball is
      const spot = tr.state === 'armed' ? (tr.launch ?? tr.hint) : null;
      if (spot) {
        const k = c.width / tr.w;
        ctx.strokeStyle = '#4cd964';
        ctx.lineWidth = Math.max(2, c.width / 400);
        ctx.beginPath();
        ctx.arc(spot.x * k, spot.y * k, c.width / 40, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    next();
  };

  const tapBall = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (phase === 'idle' || phase === 'flying') return;
    const c = canvas.current!;
    const rect = c.getBoundingClientRect();
    const dw = Math.min(DETECT_W, c.width);
    arm({ x: ((e.clientX - rect.left) / rect.width) * dw, y: ((e.clientY - rect.top) / rect.height) * ((c.height / c.width) * dw) });
  };

  const latest = shots[0];
  const fmt = (m: number) => `${Math.round(units === 'yd' ? m * 1.0936 : m)}`;
  const lands = (lat: number) => (Math.abs(lat) < 2 ? 'On line' : `${fmt(Math.abs(lat))}${units} ${lat > 0 ? 'R' : 'L'}`);
  const [calMsg, setCalMsg] = useState<string | null>(null);
  const calibrate = async () => {
    const a = Number(actual);
    if (!latest?.seen || !(a > 0)) return;
    const metres = units === 'yd' ? a / 1.0936 : a;
    setCalMsg('Calibrating…');
    const { factor, res } = await calibrateInBackground(latest.seen.cam, latest.seen.obs, latest.club, metres, cal);
    setCal(factor);
    writeNum(CAL_KEY, factor);
    // Re-read this shot with the new calibration so the numbers update straight away
    if (res) setShots((prev) => prev.map((sh) => (sh.n === latest.n ? { ...sh, result: res } : sh)));
    setActual('');
    setCalMsg(
      `Calibrated: you hit it ${Math.abs(Math.round((factor - 1) * 100))}% ${factor >= 1 ? 'harder' : 'softer'} than a typical club golfer. Applies to every club.`,
    );
  };

  return (
    <div className="screen">
      <Header title="Shot tracer sim" onBack={() => go({ name: 'tracer' })} />
      <div className="content">
        {phase === 'idle' && (
          <Card>
            <p>
              <strong>Set up:</strong> stand the phone on your bag (or a phone tripod) 2 to 4 m behind the ball,{' '}
              <strong>pointing straight down your target line</strong>. It must stay still.
            </p>
            <ol className="small">
              <li>
                Tap <strong>Start</strong> and allow the camera, microphone and motion sensor.
              </li>
              <li>Hit. No tapping: it hears the strike, finds the ball and traces it.</li>
              <li>Carry, apex, curve and where it landed come up after every shot, and it's ready for the next.</li>
            </ol>
            <div className="field">
              <span>Phone height</span>
              <Segmented
                value={String(height) as '0.6' | '1' | '1.3'}
                onChange={(v) => {
                  setHeight(Number(v));
                  writeNum(HEIGHT_KEY, Number(v));
                }}
                options={[
                  { value: '0.6', label: 'Low tripod' },
                  { value: '1', label: 'On the bag' },
                  { value: '1.3', label: 'Chest height' },
                ]}
              />
            </div>
            <button className="btn primary block big" onClick={startCamera}>
              📹 Start
            </button>
          </Card>
        )}
        {err && <p className="error">{err}</p>}
        <div className={`tracer-stage ${phase === 'idle' ? 'collapsed' : ''}`}>
          <video ref={video} playsInline muted className="tracer-video" />
          <canvas ref={canvas} className="tracer-canvas" onPointerDown={tapBall} />
          {phase !== 'idle' && (
            <div className={`live-badge ${phase}`}>
              {phase === 'aim' && 'Tap the ball'}
              {phase === 'armed' && (mic ? (ballSeen ? '● Ball found: hit away' : '● Ready: hit away') : '● Ready')}
              {phase === 'flying' && '● Tracking…'}
            </div>
          )}
          {latest?.result && phase !== 'flying' && (
            <div className="sim-hud">
              <div className="sim-big">
                {fmt(latest.result.carry)}
                <small>{units} carry</small>
              </div>
              <div className="sim-row">
                <span>
                  Apex {fmt(latest.result.apex)}
                  {units}
                </span>
                <span>{latest.result.shape}</span>
                <span>{lands(latest.result.lateral)}</span>
              </div>
            </div>
          )}
        </div>
        {phase !== 'idle' && (
          <div className="row gap wrap">
            <select value={club} onChange={(e) => setClub(e.target.value)} aria-label="Club">
              {settings.clubs.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <span className="muted small">
              {mic ? 'Listening for the strike' : 'No microphone: tap the ball, and keep others still'}
              {tilt ? '' : ' · tilt sensor off, so numbers are rougher'}
            </span>
          </div>
        )}

        {latest && (
          <Card title={`Shot ${latest.n}${latest.club ? ` · ${latest.club}` : ''}`}>
            {latest.result ? (
              <div className="kpis">
                <div className="kpi">
                  <div className="kpi-label">Carry</div>
                  <div className="kpi-value">
                    {fmt(latest.result.carry)}
                    {units}
                  </div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">Apex</div>
                  <div className="kpi-value">
                    {fmt(latest.result.apex)}
                    {units}
                  </div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">Hang</div>
                  <div className="kpi-value">{latest.result.hang.toFixed(1)}s</div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">Start</div>
                  <div className="kpi-value">
                    {Math.abs(latest.result.startDir) < 1 ? 'Straight' : `${Math.abs(latest.result.startDir).toFixed(0)}° ${latest.result.startDir > 0 ? 'R' : 'L'}`}
                  </div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">Shape</div>
                  <div className="kpi-value">{latest.result.shape}</div>
                  <div className="kpi-sub">
                    {fmt(Math.abs(latest.result.curveM))}
                    {units} curve
                  </div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">Lands</div>
                  <div className="kpi-value">{lands(latest.result.lateral)}</div>
                </div>
              </div>
            ) : (
              <p className="small">Couldn't read that one clearly enough for numbers. The tracer's saved, and you can fix it by hand.</p>
            )}
            <button
              className="btn primary block"
              onClick={() => {
                handOff(latest.handoff);
                go({ name: 'tracer' });
              }}
            >
              💾 Save / share this shot
            </button>
            {calMsg && <p className="ok small">{calMsg}</p>}
            {latest.result && latest.seen && (
              <form
                className="row gap"
                onSubmit={(e) => {
                  e.preventDefault();
                  calibrate();
                }}
              >
                <input className="grow" inputMode="numeric" placeholder={`Know the real carry? (${units})`} value={actual} onChange={(e) => setActual(e.target.value)} />
                <button className="btn">Calibrate</button>
              </form>
            )}
            <p className="muted small">
              Numbers are estimated from the ball's flight on camera, using the club you picked for ball speed
              {cal !== 1 ? ` (calibrated to your swing: ${cal >= 1 ? '+' : ''}${Math.round((cal - 1) * 100)}% speed)` : ''}. Calibrate once with a shot of known carry
              (e.g. to a marked flag) for best accuracy.
            </p>
          </Card>
        )}

        {shots.some((s) => s.result) && (
          <Card title="Session">
            <Dispersion shots={shots} units={units} />
            <table className="totals">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Club</th>
                  <th>Carry</th>
                  <th>Lands</th>
                  <th>Shape</th>
                </tr>
              </thead>
              <tbody>
                {shots.map((s) => (
                  <tr key={s.n}>
                    <td>{s.n}</td>
                    <td>{s.club}</td>
                    <td>{s.result ? `${fmt(s.result.carry)}${units}` : '–'}</td>
                    <td>{s.result ? lands(s.result.lateral) : '–'}</td>
                    <td>{s.result?.shape ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}

/** Top-down view of where each shot landed, like a launch monitor's dispersion chart. */
function Dispersion({ shots, units }: { shots: SessionShot[]; units: 'm' | 'yd' }) {
  const res = shots.filter((s) => s.result);
  const maxCarry = Math.max(100, ...res.map((s) => s.result!.carry)) * 1.15;
  const step = maxCarry > 220 ? 50 : 25;
  const W = 220,
    H = 240,
    pad = 16;
  const sy = (H - pad * 2) / maxCarry;
  const latRange = Math.max(30, ...res.map((s) => Math.abs(s.result!.lateral) * 1.3));
  const sx = (W / 2 - pad) / latRange;
  const X = (lat: number) => W / 2 + lat * sx;
  const Y = (carry: number) => H - pad - carry * sy;
  const conv = (m: number) => Math.round(units === 'yd' ? m * 1.0936 : m);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="dispersion" role="img" aria-label="Where your shots landed">
      <rect x="0" y="0" width={W} height={H} rx="10" className="disp-bg" />
      {Array.from({ length: Math.floor(maxCarry / step) }, (_, i) => (i + 1) * step).map((d) => (
        <g key={d}>
          <line x1={pad} x2={W - pad} y1={Y(d)} y2={Y(d)} className="disp-ring" />
          <text x={W - pad} y={Y(d) - 2} textAnchor="end" className="disp-label">
            {conv(d)}
          </text>
        </g>
      ))}
      <line x1={W / 2} x2={W / 2} y1={H - pad} y2={pad} className="disp-target" />
      {res.map((s, i) => {
        const r0 = s.result!;
        const mid = { x: X(r0.lateral - r0.curveM * 0.6), y: Y(r0.carry * 0.55) };
        return (
          <g key={s.n} opacity={i === 0 ? 1 : 0.55}>
            {i === 0 && <path d={`M ${W / 2} ${H - pad} Q ${mid.x} ${mid.y} ${X(r0.lateral)} ${Y(r0.carry)}`} className="disp-flight" />}
            <circle cx={X(r0.lateral)} cy={Y(r0.carry)} r={i === 0 ? 5 : 3.5} className={i === 0 ? 'disp-dot latest' : 'disp-dot'} />
          </g>
        );
      })}
    </svg>
  );
}
