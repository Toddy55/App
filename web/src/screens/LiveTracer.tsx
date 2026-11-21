import { useEffect, useRef, useState } from 'react';
import { BallTracker, diffBlobs, StrikeDetector, toGray, type Flight } from '../lib/balltrack';
import { drawTracer, type Pt } from '../lib/tracer';
import { handOff } from '../lib/traceHandoff';
import { Card, Header, type Go } from '../components/ui';

type Phase = 'idle' | 'aim' | 'armed' | 'flying' | 'done';

const COLOUR = '#ff3b30';
const DETECT_W = 320;

/**
 * Live shot tracer: the phone sits still behind the golfer, you tap the ball,
 * and the tracer draws itself as the ball flies. The clip is recorded so it
 * can be saved, shared or touched up afterwards.
 */
export function LiveTracer({ go }: { go: Go }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [mic, setMic] = useState(false);
  const [lost, setLost] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const r = useRef({
    stream: null as MediaStream | null,
    tracker: null as BallTracker | null,
    launch: null as Pt | null, // in detection pixels
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
    finishing: false,
    stopLoop: false,
    // diagnostics (visible as window.__liveTracer for troubleshooting)
    diag: { maxPeak: 0, strikes: [] as number[], frames: 0, blobsLast: 0 },
  });
  (window as unknown as { __liveTracer?: unknown }).__liveTracer = r.current;
  r.current.phase = phase;

  // Stop the camera and microphone when leaving the screen
  useEffect(
    () => () => {
      const s = r.current;
      s.stopLoop = true;
      if (s.rec && s.rec.state !== 'inactive') s.rec.stop();
      s.stream?.getTracks().forEach((t) => t.stop());
      s.audioCtx?.close().catch(() => {});
    },
    [],
  );

  const startCamera = async () => {
    setErr(null);
    const s = r.current;
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
    setPhase('aim'); // show the preview first: a hidden video never starts on some phones
    v.play().catch(() => {});
    if (s.stream.getAudioTracks().length) {
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
    loop();
  };

  const startRecording = () => {
    const s = r.current;
    if (!s.stream || !s.mime) return;
    s.chunks = [];
    s.rec = new MediaRecorder(s.stream, { mimeType: s.mime, videoBitsPerSecond: 8_000_000 });
    s.rec.ondataavailable = (e) => e.data.size && s.chunks.push(e.data);
    s.rec.start(500);
    s.recStart = performance.now() / 1000;
  };

  const arm = (launch: Pt) => {
    const s = r.current;
    const v = video.current!;
    const dw = Math.min(DETECT_W, v.videoWidth);
    const dh = Math.round((v.videoHeight / v.videoWidth) * dw);
    s.launch = launch;
    s.tracker = new BallTracker(launch, dw, dh, !!s.analyser);
    s.prev = null;
    s.flight = null;
    s.finishing = false;
    setLost(false);
    startRecording();
    setPhase('armed');
  };

  const finish = async () => {
    const s = r.current;
    if (s.finishing) return;
    s.finishing = true;
    const f = s.flight;
    const v = video.current!;
    const rec = s.rec;
    if (!rec || !f) return;
    if (rec.state !== 'inactive') {
      await new Promise<void>((res) => {
        rec.onstop = () => res();
        rec.stop();
      });
    }
    const type = s.mime.split(';')[0];
    const file = new File([new Blob(s.chunks, { type })], `shot-tracer.${type.includes('mp4') ? 'mp4' : 'webm'}`, { type });
    // Convert to video pixels and clip time
    const k = v.videoWidth / s.tracker!.w;
    const P = (p: Pt) => ({ x: p.x * k, y: p.y * k });
    const rel = (t: number) => Math.max(0, t - s.recStart);
    setLost(s.tracker!.pts.length < 8);
    handOff({
      file,
      start: { ...P(f.at(f.t0)), t: rel(f.t0) },
      end: { ...P(f.at(f.tEnd)), t: rel(f.tEnd) },
      apex: P(f.at(f.tApex)),
    });
    setPhase('done');
  };

  const loop = () => {
    const s = r.current;
    const v = video.current;
    const c = canvas.current;
    if (s.stopLoop || !v || !c) return;
    const next = () => {
      const rv = v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
      if (rv.requestVideoFrameCallback) rv.requestVideoFrameCallback(() => loop());
      else requestAnimationFrame(loop);
    };
    if (!v.videoWidth) return next();
    const t = performance.now() / 1000;
    if (c.width !== v.videoWidth) {
      c.width = v.videoWidth;
      c.height = v.videoHeight;
    }
    const ctx = c.getContext('2d')!;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    const tr = s.tracker;

    if (tr && (s.phase === 'armed' || s.phase === 'flying')) {
      // Strike sound
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
      // Motion
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
        const blobs = diffBlobs(s.prev, cur, tr.w, tr.h, 30, tr.maxArea * 4);
        s.diag.frames++;
        s.diag.blobsLast = blobs.length;
        tr.feed(blobs, t);
      }
      s.prev = cur;

      const f = tr.flight();
      if (f) {
        s.flight = f;
        if (s.phase === 'armed') setPhase('flying');
        const k = c.width / tr.w;
        const until = Math.min(t, f.tEnd);
        const n = 60;
        const pts: Pt[] = [];
        for (let i = 0; i <= n; i++) {
          const p = f.at(f.t0 + ((until - f.t0) * i) / n);
          pts.push({ x: p.x * k, y: p.y * k });
        }
        drawTracer(ctx, pts, { color: COLOUR, width: Math.max(4, c.width / 160) }, t < f.tEnd);
        if (tr.state === 'done' && !s.finishing) {
          const wait = Math.max(0, f.tEnd + 1.5 - t);
          s.finishing = true;
          setTimeout(() => {
            s.finishing = false;
            finish();
          }, wait * 1000);
        }
      }
      // Nothing launched for a minute: start a fresh recording so clips stay short
      if (s.phase === 'armed' && t - s.recStart > 60 && s.rec) {
        s.rec.stop();
        startRecording();
      }
    }

    if (s.launch && (s.phase === 'armed' || s.phase === 'aim')) {
      const k = c.width / (tr?.w ?? Math.min(DETECT_W, c.width));
      ctx.strokeStyle = s.phase === 'armed' ? '#4cd964' : '#fff';
      ctx.lineWidth = Math.max(2, c.width / 400);
      ctx.beginPath();
      ctx.arc(s.launch.x * k, s.launch.y * k, c.width / 40, 0, Math.PI * 2);
      ctx.stroke();
    }
    next();
  };

  const tapBall = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (phase !== 'aim' && phase !== 'armed') return;
    const c = canvas.current!;
    const rect = c.getBoundingClientRect();
    const dw = Math.min(DETECT_W, c.width);
    const p = { x: ((e.clientX - rect.left) / rect.width) * dw, y: ((e.clientY - rect.top) / rect.height) * ((c.height / c.width) * dw) };
    if (r.current.rec && r.current.rec.state !== 'inactive') r.current.rec.stop();
    arm(p);
  };

  const again = () => {
    const s = r.current;
    if (s.launch) arm(s.launch);
    else setPhase('aim');
  };

  return (
    <div className="screen">
      <Header title="Live tracer" onBack={() => go({ name: 'tracer' })} />
      <div className="content">
        {phase === 'idle' && (
          <Card>
            <p>
              <strong>Set up:</strong> lean the phone on your bag (or a phone tripod) a few metres behind the golfer, looking down the target line. It
              must stay still.
            </p>
            <ol className="small">
              <li>Tap <strong>Start camera</strong>, then tap the ball on screen.</li>
              <li>Hit away. The tracer draws itself as the ball flies.</li>
              <li>Save or share the clip, or fix the tracer if it got it wrong.</li>
            </ol>
            <button className="btn primary block big" onClick={startCamera}>
              📹 Start camera
            </button>
            <p className="muted small">Allow the microphone too: the app listens for the strike so it doesn't mistake the backswing for the shot.</p>
          </Card>
        )}
        {err && <p className="error">{err}</p>}
        <div className={`tracer-stage ${phase === 'idle' ? 'collapsed' : ''}`}>
          <video ref={video} playsInline muted className="tracer-video" />
          <canvas ref={canvas} className="tracer-canvas" onPointerDown={tapBall} />
          {phase !== 'idle' && phase !== 'done' && (
            <div className={`live-badge ${phase}`}>
              {phase === 'aim' && 'Tap the ball'}
              {phase === 'armed' && (mic ? '● Ready: listening for the strike' : '● Ready: hit away')}
              {phase === 'flying' && '● Tracking…'}
            </div>
          )}
        </div>
        {phase === 'aim' && <p className="tracer-prompt">Keep the phone still and tap the ball on screen.</p>}
        {phase === 'armed' && (
          <p className="muted small">
            Wrong spot? Tap the ball again. {mic ? '' : 'No microphone, so keep everyone else still: any movement near the ball can set it off.'}
          </p>
        )}
        {phase === 'done' && (
          <Card title="Shot traced 🎯">
            {lost && <p className="small">The ball was hard to follow, so check the line.</p>}
            <button className="btn primary block" onClick={() => go({ name: 'tracer' })}>
              💾 Save / share / fix this clip
            </button>
            <button className="btn block" onClick={again}>
              ⛳ Next shot
            </button>
          </Card>
        )}
      </div>
    </div>
  );
}
