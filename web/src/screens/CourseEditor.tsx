import { useState } from 'react';
import type { Course, Hole, LatLon } from '../types';
import { store } from '../lib/storage';
import { blankHoles, courseCompleteness } from '../lib/courses';
import { distanceM, fmtDist } from '../lib/geo';
import { getPosition } from '../hooks';
import { HoleMap } from '../components/HoleMap';
import { TeesEditor } from '../components/TeesEditor';
import { Card, Header, Segmented, Stepper, type Go } from '../components/ui';

export function CourseEditor({ go, id }: { go: Go; id: string }) {
  const [course, setCourse] = useState<Course | undefined>(() => store.courses().find((c) => c.id === id));
  const [sel, setSel] = useState(1);
  const [mode, setMode] = useState<'green' | 'tee'>('green');
  const [msg, setMsg] = useState<string | null>(null);
  const units = store.settings().units;

  if (!course) return <div className="screen"><Header title="Course" onBack={() => go({ name: 'courses' })} /><p className="content">Course not found.</p></div>;

  const save = (c: Course) => {
    setCourse(c);
    store.saveCourse(c);
  };
  const setHole = (n: number, patch: Partial<Hole>) => {
    const holes = course.holes.map((h) => (h.number === n ? recalc({ ...h, ...patch }) : h));
    save({ ...course, holes });
  };
  /** Pars / stroke indexes changed by hand: they're now the golfer's, not estimates. */
  const setCard = (n: number, patch: Partial<Hole>) => {
    const holes = course.holes.map((h) => {
      if (h.number !== n) return h;
      const next: Hole = { ...h, ...patch };
      if ('par' in patch) delete next.parEst;
      if ('si' in patch) delete next.siEst;
      return next;
    });
    save({ ...course, holes, cardEdited: true });
  };
  const confirmCard = () => {
    const holes = course.holes.map((h) => {
      const next = { ...h };
      delete next.parEst;
      delete next.siEst;
      return next;
    });
    save({ ...course, holes, cardEdited: true });
  };
  const recalc = (h: Hole): Hole => (h.tee && h.green ? { ...h, lengthM: Math.round(distanceM(h.tee, h.green.centre)) } : h);
  const hole = course.holes.find((h) => h.number === sel) ?? course.holes[0];
  const comp = courseCompleteness(course);

  const place = (p: LatLon) => {
    if (mode === 'green') setHole(hole.number, { green: { centre: p } });
    else setHole(hole.number, { tee: p });
    setMsg(`${mode === 'green' ? 'Green centre' : 'Tee'} set for hole ${hole.number}`);
  };

  return (
    <div className="screen">
      <Header title="Course" onBack={() => go({ name: 'courses' })} />
      <div className="content">
        <Card>
          <label className="field">
            <span>Name</span>
            <input value={course.name} onChange={(e) => save({ ...course, name: e.target.value })} />
          </label>
          <div className="row gap">
            <label className="field grow">
              <span>Scratch rating</span>
              <input
                inputMode="decimal"
                placeholder="e.g. 71.5"
                value={course.scratchRating ?? ''}
                onChange={(e) => save({ ...course, scratchRating: e.target.value ? Number(e.target.value) : undefined })}
              />
            </label>
            <label className="field grow">
              <span>Slope rating</span>
              <input
                inputMode="numeric"
                placeholder="e.g. 128"
                value={course.slopeRating ?? ''}
                onChange={(e) => save({ ...course, slopeRating: e.target.value ? Number(e.target.value) : undefined })}
              />
            </label>
          </div>
          <p className="muted small">
            Ratings for your tee are on the club scorecard or GolfLink. They make your Daily Handicap exact. Par {course.holes.reduce((s, h) => s + h.par, 0)} ·{' '}
            {comp.mapped}/{comp.total} greens mapped{!comp.hasSI && ' · ⚠️ stroke indexes need checking'}
          </p>
          <div className="row gap">
            <button className="btn small" onClick={() => save({ ...course, holes: course.holes.length === 18 ? course.holes.slice(0, 9) : [...course.holes, ...blankHoles(18).slice(course.holes.length)] })}>
              Make {course.holes.length === 18 ? '9' : '18'} holes
            </button>
            <button className="btn primary small" onClick={() => go({ name: 'setup', courseId: course.id })}>
              Play this course
            </button>
          </div>
        </Card>

        <TeesEditor course={course} save={save} units={units} />
        <Card title="Scorecard">
          {!course.cardEdited && course.holes.some((h) => h.parEst || h.siEst) && (
            <p className="warn small">
              ⚠️ Pars marked <em>est.</em> were worked out from the hole's length because the map data has none, and stroke indexes marked{' '}
              <em>est.</em> are just the hole number. Match them to the club scorecard.
            </p>
          )}
          <table className="card-edit">
            <thead>
              <tr>
                <th>Hole</th>
                <th>{units}</th>
                <th>Par</th>
                <th>SI</th>
              </tr>
            </thead>
            <tbody>
              {course.holes.map((h) => {
                const dupSI = course.holes.filter((x) => x.si === h.si).length > 1;
                return (
                  <tr key={h.number}>
                    <td className="n">{h.number}</td>
                    <td className="len">{h.lengthM ? fmtDist(h.lengthM, units) : '–'}</td>
                    <td>
                      <div className="par-pick">
                        {[3, 4, 5].map((v) => (
                          <button key={v} className={h.par === v ? 'on' : ''} onClick={() => setCard(h.number, { par: v })}>
                            {v}
                          </button>
                        ))}
                        {h.parEst && !course.cardEdited && <span className="est">est.</span>}
                      </div>
                    </td>
                    <td>
                      <input
                        className={`si-in ${dupSI ? 'dup' : ''}`}
                        inputMode="numeric"
                        value={h.si}
                        onChange={(e) => {
                          const v = Math.round(Number(e.target.value));
                          if (v >= 1 && v <= 18) setCard(h.number, { si: v });
                        }}
                      />
                      {h.siEst && !course.cardEdited && <span className="est">est.</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small">
            Par {course.holes.reduce((a, h) => a + h.par, 0)}
            {new Set(course.holes.map((h) => h.si)).size !== course.holes.length ? ' · ⚠️ two holes share a stroke index' : ''}
          </p>
          {!course.cardEdited && (
            <button className="btn block" onClick={confirmCard}>
              ✅ Matches the club card
            </button>
          )}
        </Card>

        <div className="hole-chips">
          {course.holes.map((h) => (
            <button key={h.number} className={`chip ${h.number === sel ? 'on' : ''} ${h.green ? 'mapped' : ''}`} onClick={() => setSel(h.number)}>
              {h.number}
            </button>
          ))}
        </div>

        <Card title={`Hole ${hole.number}`}>
          <div className="row gap wrap">
            <Stepper label="Par" value={hole.par} min={3} max={6} onChange={(v) => setCard(hole.number, { par: v })} />
            <Stepper label="SI" value={hole.si} min={1} max={18} onChange={(v) => setCard(hole.number, { si: v })} />
            <label className="field narrow">
              <span>Length (m)</span>
              <input inputMode="numeric" value={hole.lengthM ?? ''} onChange={(e) => setHole(hole.number, { lengthM: e.target.value ? Number(e.target.value) : undefined })} />
            </label>
          </div>
          <div className="row between">
            <Segmented value={mode} onChange={setMode} options={[{ value: 'green', label: 'Place green' }, { value: 'tee', label: 'Place tee' }]} />
            <button
              className="btn small"
              onClick={async () => {
                try {
                  place(await getPosition());
                } catch (e) {
                  setMsg(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              📍 I'm standing on it
            </button>
          </div>
          <p className="muted small">Tap the map to place the {mode} for hole {hole.number}.{hole.green?.polygon ? ' This green has an outline from OpenStreetMap; placing it again replaces the outline.' : ''}</p>
          {msg && <p className="ok small">{msg}</p>}
          <HoleMap hole={hole} units={units} centre={hole.green?.centre ?? hole.tee ?? course.location} onTap={place} height={340} />
          <div className="row between">
            <button className="btn ghost" disabled={sel <= 1} onClick={() => setSel(sel - 1)}>
              ‹ Prev
            </button>
            <button className="btn ghost" disabled={sel >= course.holes.length} onClick={() => setSel(sel + 1)}>
              Next ›
            </button>
          </div>
        </Card>
        <button
          className="btn danger ghost"
          onClick={() => {
            if (confirm(`Delete ${course.name}?`)) {
              store.deleteCourse(course.id);
              go({ name: 'courses' });
            }
          }}
        >
          Delete course
        </button>
      </div>
    </div>
  );
}
