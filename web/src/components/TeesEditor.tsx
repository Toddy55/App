import { useState } from 'react';
import type { Course, TeeSet } from '../types';
import { fmtDist } from '../lib/geo';
import { TEE_COLOURS } from '../lib/tees';
import { Card } from './ui';

/** The club's tee boxes: name, colour, ratings and each hole's length off the scorecard. */
export function TeesEditor({ course, save, units }: { course: Course; save: (c: Course) => void; units: 'm' | 'yd' }) {
  const tees = course.tees ?? [];
  const [open, setOpen] = useState<string | null>(tees[0]?.id ?? null);
  const setTees = (t: TeeSet[]) => save({ ...course, tees: t });
  const patch = (id: string, p: Partial<TeeSet>) => setTees(tees.map((t) => (t.id === id ? { ...t, ...p } : t)));
  const add = (c: { name: string; colour: string }) => {
    const id = `${c.name.toLowerCase()}-${Date.now().toString(36).slice(-4)}`;
    setTees([...tees, { id, name: c.name, colour: c.colour, lengths: {} }]);
    setOpen(id);
  };
  const toUnits = (m: number) => Math.round(units === 'yd' ? m * 1.0936 : m);
  const fromUnits = (v: number) => Math.round(units === 'yd' ? v / 1.0936 : v);
  const unused = TEE_COLOURS.filter((c) => !tees.some((t) => t.name === c.name));

  return (
    <Card title="Tees">
      <p className="muted small">
        Add the club's tee boxes off the scorecard. Pick your tee when you set up a round, and every distance, the hole view and the caddie play from it. {tees.length === 0 && 'Until then, Back, Middle and Forward are estimated from the mapped tee.'}
      </p>
      {tees.map((t) => {
        const total = course.holes.reduce((s, h) => s + (t.lengths?.[h.number] ?? h.lengthM ?? 0), 0);
        const isOpen = open === t.id;
        return (
          <div key={t.id} className="tee-edit">
            <button className="tee-edit-head" onClick={() => setOpen(isOpen ? null : t.id)}>
              <i style={{ background: t.colour ?? '#94a3b8' }} />
              <strong>{t.name}</strong>
              <span className="muted small">
                {fmtDist(total, units)}
                {units}
                {t.slopeRating ? ` · slope ${t.slopeRating}` : ''}
              </span>
              <span>{isOpen ? '▾' : '▸'}</span>
            </button>
            {isOpen && (
              <div className="tee-edit-body">
                <label className="field">
                  <span>Name</span>
                  <input value={t.name} onChange={(e) => patch(t.id, { name: e.target.value.slice(0, 20) })} />
                </label>
                <div className="tee-ratings">
                  <label className="field">
                    <span>Slope</span>
                    <input inputMode="numeric" value={t.slopeRating ?? ''} onChange={(e) => patch(t.id, { slopeRating: Number(e.target.value) || undefined })} />
                  </label>
                  <label className="field">
                    <span>Scratch</span>
                    <input inputMode="decimal" value={t.scratchRating ?? ''} onChange={(e) => patch(t.id, { scratchRating: Number(e.target.value) || undefined })} />
                  </label>
                </div>
                <span className="muted small">Each hole's length ({units}) off the scorecard:</span>
                <div className="tee-lengths">
                  {course.holes.map((h) => (
                    <label key={h.number}>
                      <span>{h.number}</span>
                      <input
                        inputMode="numeric"
                        placeholder={h.lengthM ? String(toUnits(h.lengthM)) : '–'}
                        defaultValue={t.lengths?.[h.number] ? toUnits(t.lengths[h.number]) : ''}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          const lengths = { ...(t.lengths ?? {}) };
                          if (v > 30) lengths[h.number] = fromUnits(v);
                          else delete lengths[h.number];
                          patch(t.id, { lengths });
                        }}
                      />
                    </label>
                  ))}
                </div>
                <button className="btn ghost small" onClick={() => setTees(tees.filter((x) => x.id !== t.id))}>
                  Remove {t.name} tees
                </button>
              </div>
            )}
          </div>
        );
      })}
      <div className="row gap wrap">
        {unused.slice(0, 5).map((c) => (
          <button key={c.name} className="chip tee-chip" onClick={() => add(c)}>
            <i style={{ background: c.colour }} />+ {c.name}
          </button>
        ))}
      </div>
    </Card>
  );
}
