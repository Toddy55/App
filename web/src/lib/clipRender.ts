import { drawTracer } from './tracer';
import type { TraceHandoff } from './traceHandoff';

/**
 * Make a small clip of a sim shot to send to mates watching live: about
 * 360 px wide, from just before the strike to just after landing, with the
 * tracer and the numbers drawn in. A few hundred KB instead of many MB.
 *
 * It plays the original once in a hidden video while recording a canvas,
 * so it takes about as long as the clip (5–8 s), in the background.
 */
export async function renderShareClip(h: TraceHandoff, width = 360): Promise<{ blob: Blob; mime: string } | null> {
  if (typeof MediaRecorder === 'undefined' || !h.path?.length) return null;
  const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  const mime = types.find((t) => MediaRecorder.isTypeSupported(t));
  if (!mime) return null;

  const url = URL.createObjectURL(h.file);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;
  try {
    await new Promise<void>((res, rej) => {
      v.onloadedmetadata = () => res();
      v.onerror = () => rej(new Error('video'));
      setTimeout(() => rej(new Error('timeout')), 8000);
    });
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    if (!vw || !vh) return null;
    const k = width / vw;
    const c = document.createElement('canvas');
    c.width = width;
    c.height = Math.round(vh * k) & ~1;
    const ctx = c.getContext('2d');
    if (!ctx || !c.captureStream) return null;

    const pts = h.path.map((p) => ({ x: p.x * k, y: p.y * k, t: p.t }));
    const from = Math.max(0, h.start.t - 1.2);
    const to = Math.min(v.duration || h.end.t + 2, h.end.t + 1.8);
    v.currentTime = from;
    await new Promise((r) => v.addEventListener('seeked', r, { once: true }));

    const rec = new MediaRecorder(c.captureStream(24), { mimeType: mime, videoBitsPerSecond: 450_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise((r) => (rec.onstop = r));
    const draw = () => {
      ctx.drawImage(v, 0, 0, c.width, c.height);
      const t = v.currentTime;
      const shown = pts.filter((p) => p.t <= t);
      if (shown.length > 1) drawTracer(ctx, shown, { color: '#ffd166', width: 4 }, t < h.end.t);
      if (t >= h.end.t - 0.05 && h.info?.length) {
        ctx.save();
        ctx.fillStyle = 'rgba(8,22,46,0.82)';
        const lineH = 17;
        const boxH = 10 + lineH * h.info.length;
        ctx.fillRect(8, c.height - boxH - 8, c.width - 16, boxH);
        ctx.fillStyle = '#fff';
        ctx.font = '600 13px system-ui, sans-serif';
        h.info.forEach((l, i) => ctx.fillText(l, 16, c.height - boxH - 8 + 20 + i * lineH));
        ctx.restore();
      }
    };
    rec.start(250);
    await v.play();
    await new Promise<void>((resolve) => {
      const tick = () => {
        draw();
        if (v.currentTime >= to || v.ended) resolve();
        else requestAnimationFrame(tick);
      };
      tick();
    });
    v.pause();
    rec.stop();
    await stopped;
    const type = mime.split(';')[0];
    return { blob: new Blob(chunks, { type }), mime: type };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
