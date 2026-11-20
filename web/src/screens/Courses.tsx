import { useRef, useState } from 'react';
import { blankHoles, courseCompleteness, loadCourse, nearbyCourses, searchCourses, type CourseHit } from '../lib/courses';
import { store, uid } from '../lib/storage';
import { getPosition } from '../hooks';
import { Card, Header, type Go } from '../components/ui';

export function Courses({ go, pick }: { go: Go; pick?: boolean }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<CourseHit[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, refresh] = useState(0);
  const saved = store.courses();

  // Each search gets a number; a newer search replaces an older one that's still waiting.
  const req = useRef(0);
  const run = async (label: string, fn: (progress: (l: string) => void) => Promise<CourseHit[]>) => {
    const id = ++req.current;
    setBusy(label);
    setError(null);
    try {
      const res = await fn((l) => id === req.current && setBusy(l));
      if (id === req.current) setHits(res);
    } catch (e) {
      if (id === req.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === req.current) setBusy(null);
    }
  };

  const choose = async (hit: CourseHit) => {
    const existing = saved.find((c) => c.osmRef === hit.osmRef);
    if (existing) return open(existing.id);
    setBusy(`Downloading ${hit.name}…`);
    setError(null);
    try {
      const course = await loadCourse(hit);
      store.saveCourse(course);
      open(course.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const open = (id: string) => (pick ? go({ name: 'setup', courseId: id }) : go({ name: 'course', id }));

  const createBlank = () => {
    const c = { id: uid(), name: q.trim() || 'My course', holes: blankHoles(18), source: 'manual' as const, updatedAt: Date.now() };
    store.saveCourse(c);
    go({ name: 'course', id: c.id });
  };

  return (
    <div className="screen">
      <Header title={pick ? 'Pick a course' : 'Courses'} onBack={() => go(pick ? { name: 'setup' } : { name: 'home' })} />
      <div className="content">
        <Card>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim().length >= 3) run('Searching…', () => searchCourses(q));
            }}
          >
            <input className="grow" placeholder="Course or town, e.g. Nambour" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn primary" disabled={q.trim().length < 3}>
              Search
            </button>
          </form>
          <div className="row gap">
            <button
              className="btn"
              onClick={() =>
                run('Getting your location…', async (progress) => {
                  const at = await getPosition(false);
                  progress('Finding courses near you…');
                  return nearbyCourses(at);
                })
              }
            >
              📍 Near me
            </button>
            <button className="btn ghost" onClick={createBlank}>
              + Add manually
            </button>
          </div>
          {busy && <p className="muted">{busy}</p>}
          {error && <p className="error">{error}</p>}
          {hits && (
            <ul className="list">
              {hits.length === 0 && <li className="muted">No courses found. Try a shorter name or add it manually.</li>}
              {hits.map((h) => (
                <li key={h.osmRef}>
                  <button className="list-btn" onClick={() => choose(h)} disabled={!!busy}>
                    <div>
                      <strong>{h.name}</strong>
                      <div className="muted small">{[h.suburb, h.state].filter(Boolean).join(', ') || 'Australia'}</div>
                    </div>
                    {h.distanceKm != null && <span className="muted small">{h.distanceKm.toFixed(1)} km</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Saved courses">
          {saved.length === 0 && <p className="muted">Courses you download are saved on your phone, so they work with no reception out on the course.</p>}
          <ul className="list">
            {saved.map((c) => {
              const comp = courseCompleteness(c);
              return (
                <li key={c.id}>
                  <button className="list-btn" onClick={() => open(c.id)}>
                    <div>
                      <strong>{c.name}</strong>
                      <div className="muted small">
                        {c.holes.length} holes · par {c.holes.reduce((s, h) => s + h.par, 0)} · {comp.mapped}/{comp.total} greens mapped
                      </div>
                    </div>
                    <span>›</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {saved.length > 0 && !pick && (
            <button
              className="btn ghost small"
              onClick={() => {
                if (confirm('Delete all saved courses?')) {
                  saved.forEach((c) => store.deleteCourse(c.id));
                  refresh((n) => n + 1);
                }
              }}
            >
              Clear saved courses
            </button>
          )}
        </Card>
        <p className="muted small center">
          Course maps © OpenStreetMap contributors. Hole detail varies by course: check pars and stroke indexes against the club scorecard.
        </p>
      </div>
    </div>
  );
}
