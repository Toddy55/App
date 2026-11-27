import { useEffect, useRef, useState } from 'react';
import { drawTracer, flightProgress, tracePoints, type Pt } from '../lib/tracer';
import { Card, Header, type Go } from '../components/ui';
import { takeHandoff } from '../lib/traceHandoff';

type Step = 'pick' | 'start' | 'end' | 'apex' | 'done';
interface Mark extends Pt {
  t: number;
}

const COLOURS = [
  { name: 'Red', value: '#ff3b30' },
  { name: 'Gold', value: '#ffd60a' },
  { name: 'White', value: '#ffffff' },
  { name: 'Blue', value: '#40c4ff' },
];

const PROMPTS: Record<Step, string> = {
  pick: '',
  start: 'Slide to the moment the club hits the ball, then tap the ball.',
  end: 'Now slide forward to where the ball lands (or the last frame you can see it), then tap that spot.',
  apex: 'Tap the highest point the ball reached. Tap left or right of centre for a draw or fade.',
  done: '',
};

/** Film a shot (or pick a video) and draw a TV-style tracer over the ball flight. */
export function Tracer({ go }: { go: Go }) {
  // A clip from the live tracer arrives already traced
  const [handoff] = useState(() => takeHandoff());
  const [url, setUrl] = useState<string | null>(() => (handoff ? URL.createObjectURL(handoff.file) : null));
  const [step, setStep] = useState<Step>(handoff ? 'done' : 'pick');
  const [start, setStart] = useState<Mark | null>(handoff?.start ?? null);
  const [end, setEnd] = useState<Mark | null>(handoff?.end ?? null);
  const [apex, setApex] = useState<Pt | null>(handoff?.apex ?? null);
  const [colour, setColour] = useState(COLOURS[0].value);
  const [thick, setThick] = useState(1);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [clip, setClip] = useState<File | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const lastTime = useRef(-1);
  // Live-traced clips carry the whole fitted flight; editing the line switches to the tap-drawn curve
  const [usePath, setUsePath] = useState(!!handoff?.path);
  const live = useRef({ start, end, apex, colour, thick, step, exporting, usePath });
  live.current = { start, end, apex, colour, thick, step, exporting, usePath };

  // Draw the video and tracer on one canvas, every frame
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const v = video.current;
      const c = canvas.current;
      if (v && c && v.videoWidth) {
        if (c.width !== v.videoWidth) {
          c.width = v.videoWidth;
          c.height = v.videoHeight;
        }
        const ctx = c.getContext('2d')!;
        ctx.drawImage(v, 0, 0, c.width, c.height);
        const s = live.current;
        const width = Math.max(3, (c.width / 160) * s.thick);
        if (s.usePath && handoff?.path && s.step === 'done') {
          const pts = handoff.path.filter((q) => q.t <= v.currentTime);
          if (pts.length > 1) drawTracer(ctx, pts, { color: s.colour, width }, v.currentTime < handoff.path[handoff.path.length - 1].t);
        } else if (s.start && s.end && s.apex) {
          const p = s.step === 'done' ? flightProgress(v.currentTime, s.start.t, s.end.t) : 1;
          if (p > 0) {
            drawTracer(ctx, tracePoints(s.start, s.apex, s.end, p), { color: s.colour, width }, p < 1);
          }
        }
        if (handoff?.info?.length && s.step === 'done' && s.start && v.currentTime >= s.start.t) drawInfo(ctx, handoff.info, c.width);
        if (!s.exporting && s.step !== 'done') {
          for (const m of [s.start, s.end, s.apex]) {
            if (!m) continue;
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = width * 0.5;
            ctx.beginPath();
            ctx.arc(m.x, m.y, width * 2.5, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        if (Math.abs(v.currentTime - lastTime.current) > 0.03) {
          lastTime.current = v.currentTime;
          setTime(v.currentTime);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  const reset = () => {
    setUsePath(false);
    setStart(null);
    setEnd(null);
    setApex(null);
    setClip(null);
    setStep('start');
    setMsg(null);
  };

  const load = (f: File | undefined) => {
    if (!f) return;
    if (url) URL.revokeObjectURL(url);
    setUrl(URL.createObjectURL(f));
    reset();
  };

  const seek = (t: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, t));
  };

  const togglePlay = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  const tap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvas.current;
    const v = video.current;
    if (!c || !v || exporting) return;
    const r = c.getBoundingClientRect();
    const pt = { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
    v.pause();
    if (step === 'start') {
      setStart({ ...pt, t: v.currentTime });
      setStep('end');
      setMsg(null);
    } else if (step === 'end') {
      if (!start || v.currentTime <= start.t + 0.1) {
        setMsg('Slide the video forward to when the ball lands first.');
        return;
      }
      setEnd({ ...pt, t: v.currentTime });
      setStep('apex');
      setMsg(null);
    } else if (step === 'apex') {
      setApex(pt);
      setStep('done');
      seek(Math.max(0, (start?.t ?? 0) - 1));
      setTimeout(() => video.current?.play().catch(() => {}), 150);
    }
  };

  const exportClip = async () => {
    const v = video.current;
    const c = canvas.current;
    if (!v || !c || !start || !end) return;
    const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    const mime = typeof MediaRecorder !== 'undefined' ? types.find((t) => MediaRecorder.isTypeSupported(t)) : undefined;
    if (!mime || !c.captureStream) {
      setMsg("This phone can't save the traced video. Use a screen recording instead (Control Centre → ⏺), then play the clip here.");
      return;
    }
    setExporting(true);
    setMsg('Saving your clip… keep this screen open.');
    try {
      const from = Math.max(0, start.t - 1.5);
      const to = Math.min(v.duration, end.t + 2.5);
      v.pause();
      v.currentTime = from;
      await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
      const rec = new MediaRecorder(c.captureStream(30), { mimeType: mime, videoBitsPerSecond: 8_000_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const stopped = new Promise((r) => (rec.onstop = r));
      rec.start(250);
      await v.play();
      await new Promise<void>((resolve) => {
        const check = () => (v.currentTime >= to || v.ended ? resolve() : requestAnimationFrame(check));
        check();
      });
      v.pause();
      rec.stop();
      await stopped;
      const ext = mime.includes('mp4') ? 'mp4' : 'webm';
      setClip(new File([new Blob(chunks, { type: mime.split(';')[0] })], `shot-tracer.${ext}`, { type: mime.split(';')[0] }));
      setMsg('Clip ready.');
    } catch (e) {
      setMsg(`Couldn't save the clip: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  const shareClip = async () => {
    if (!clip) return;
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare?.({ files: [clip] })) {
      try {
        await navigator.share({ files: [clip], title: 'Shot tracer' });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(clip);
    a.download = clip.name;
    a.click();
  };

  return (
    <div className="screen">
      <Header title="Shot tracer" onBack={() => go({ name: 'home' })} />
      <div className="content">
        {!url && (
          <Card>
            <button className="btn primary block big" onClick={() => go({ name: 'livetracer' })}>
              📡 Live tracer
            </button>
            <p className="muted small">
              Phone on the bag behind you: it hears the strike, finds the ball and draws the tracer live, with carry, curve and
              where it landed. Works on the range or into a net.
            </p>
            <p>Or film a shot (or pick a video), tap where the ball starts, lands and peaks, and you'll get a TV-style tracer to send to the group chat.</p>
            <label className="btn block">
              🎥 Film a shot
              <input type="file" accept="video/*" capture="environment" hidden onChange={(e) => load(e.target.files?.[0])} />
            </label>
            <label className="btn block">
              📁 Pick a video
              <input type="file" accept="video/*" hidden onChange={(e) => load(e.target.files?.[0])} />
            </label>
            <p className="muted small">
              Best results: stand behind the golfer, hold the phone still (or lean it on the bag), and keep filming until the ball lands.
            </p>
          </Card>
        )}

        {url && (
          <>
            <div className="tracer-stage">
              <video
                ref={video}
                src={url}
                playsInline
                muted
                preload="auto"
                className="tracer-video"
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  const ready = () => {
                    setDuration(v.duration);
                    v.currentTime = handoff ? Math.max(0, handoff.start.t - 1) : 0.05;
                  };
                  if (Number.isFinite(v.duration)) ready();
                  else {
                    // Recorded clips can report an unknown length until we seek to the end once
                    v.addEventListener('durationchange', function fix() {
                      if (!Number.isFinite(v.duration)) return;
                      v.removeEventListener('durationchange', fix);
                      ready();
                    });
                    v.currentTime = 1e9;
                  }
                }}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
              />
              <canvas ref={canvas} className="tracer-canvas" onPointerDown={tap} />
            </div>
            {handoff && step === 'done' && <p className="tracer-prompt">Traced live. Tap ▶ to watch, then save it. If the line's off, tap "Change height/shape".</p>}
            {PROMPTS[step] && <p className="tracer-prompt">{PROMPTS[step]}</p>}
            {msg && <p className="small">{msg}</p>}

            <div className="row gap">
              <button className="icon-btn" onClick={() => seek(time - 1 / 30)} aria-label="Back one frame">
                ⏮
              </button>
              <button className="icon-btn" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
                {playing ? '⏸' : '▶'}
              </button>
              <button className="icon-btn" onClick={() => seek(time + 1 / 30)} aria-label="Forward one frame">
                ⏭
              </button>
              <input
                className="grow tracer-scrub"
                type="range"
                min={0}
                max={duration || 0}
                step={0.01}
                value={time}
                onChange={(e) => {
                  video.current?.pause();
                  seek(Number(e.target.value));
                }}
                aria-label="Video position"
              />
            </div>

            {step === 'done' && (
              <Card title="Tracer">
                <div className="row gap wrap">
                  {COLOURS.map((c) => (
                    <button
                      key={c.value}
                      className={`swatch ${colour === c.value ? 'on' : ''}`}
                      style={{ background: c.value }}
                      aria-label={c.name}
                      onClick={() => setColour(c.value)}
                    />
                  ))}
                </div>
                <label className="field">
                  <span>Thickness</span>
                  <input type="range" min={0.5} max={2} step={0.1} value={thick} onChange={(e) => setThick(Number(e.target.value))} />
                </label>
                <div className="row gap wrap">
                  <button className="btn" onClick={() => { seek(Math.max(0, (start?.t ?? 0) - 1)); video.current?.play().catch(() => {}); }}>
                    ▶ Watch again
                  </button>
                  <button className="btn" onClick={() => { setUsePath(false); setApex(null); setStep('apex'); setClip(null); }}>
                    Change height/shape
                  </button>
                  <button className="btn ghost" onClick={reset}>
                    Start over
                  </button>
                </div>
                {!clip ? (
                  <button className="btn primary block" disabled={exporting} onClick={exportClip}>
                    {exporting ? 'Saving…' : '💾 Save traced clip'}
                  </button>
                ) : (
                  <button className="btn primary block" onClick={shareClip}>
                    📤 Share / save to Photos
                  </button>
                )}
              </Card>
            )}
            <label className="btn ghost small">
              Use a different video
              <input type="file" accept="video/*" hidden onChange={(e) => load(e.target.files?.[0])} />
            </label>
          </>
        )}
      </div>
    </div>
  );
}

/** Shot data box in the top-left corner, like a sim readout. */
function drawInfo(ctx: CanvasRenderingContext2D, lines: string[], width: number) {
  const fs = Math.max(14, Math.round(width / 26));
  const pad = fs * 0.6;
  ctx.save();
  ctx.font = `700 ${fs}px system-ui, -apple-system, sans-serif`;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
  const h = lines.length * fs * 1.3 + pad * 1.4;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath();
  ctx.roundRect?.(pad, pad, w, h, fs * 0.4);
  if (!ctx.roundRect) ctx.rect(pad, pad, w, h);
  ctx.fill();
  lines.forEach((l, i) => {
    ctx.fillStyle = i === 0 ? '#ffd166' : '#ffffff';
    ctx.fillText(l, pad * 2, pad + pad * 0.7 + fs * (i + 1) * 1.3 - fs * 0.3);
  });
  ctx.restore();
}
