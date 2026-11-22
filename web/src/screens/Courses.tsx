import { useEffect, useRef, useState } from 'react';
import { blankHoles, courseCompleteness, loadCourse, nearbyCourses, searchCourses, type CourseHit } from '../lib/courses';
import { catalogToCourse, loadCatalog, searchCatalog, type Catalog, type CatalogCourse } from '../lib/courseCatalog';
import { distanceM } from '../lib/geo';
import { store, uid } from '../lib/storage';
import { Card, Header, type Go } from '../components/ui';

export function Courses({ go, pick }: { go: Go; pick?: boolean }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<CourseHit[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, refresh] = useState(0);
  const saved = store.courses();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [nearby, setNearby] = useState<(CatalogCourse & { km: number })[] | null>(null);
  useEffect(() => {
    loadCatalog().then(setCatalog).catch(() => setCatalog(null));
  }, []);
  const matches = catalog && q.trim().length >= 2 ? searchCatalog(catalog, q) : [];

  const chooseBuiltIn = async (c: CatalogCourse) => {
    const existing = saved.find((x) => x.osmRef === c.ref);
    if (existing) return open(existing.id);
    let course = catalogToCourse(c);
    // With the club's tees, where the list has them
    course = (await import('../lib/clubTees').then(({ withClubTees }) => withClubTees(course)).catch(() => null)) ?? course;
    store.saveCourse(course);
    open(course.id);
  };

  const findNear = async () => {
    setError(null);
    setBusy('Getting your location…');
    try {
      const at = await (await import('../hooks')).getPosition(false);
      const list = (catalog?.courses ?? [])
        .map((c) => ({ ...c, km: distanceM(at, { lat: c.at[0], lon: c.at[1] }) / 1000 }))
        .filter((c) => c.km < 40)
        .sort((a, b) => a.km - b.km)
        .slice(0, 15);
      if (list.length) {
        setNearby(list);
        setBusy(null);
      } else {
        // Outside the built-in region: ask the online course database
        setNearby(null);
        setBusy(null);
        run('Finding courses near you…', () => nearbyCourses(at));
      }
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

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
          <div className="typeahead">
            <input
              className="grow"
              placeholder="Type a course or town, e.g. Nambour"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setHits(null);
                setNearby(null);
              }}
              autoComplete="off"
              autoCorrect="off"
              aria-label="Course name"
            />
            {matches.length > 0 && (
              <ul className="typeahead-list" role="listbox">
                {matches.map((c) => (
                  <li key={c.ref}>
                    <button className="list-btn" onClick={() => chooseBuiltIn(c)}>
                      <div>
                        <strong>{c.name}</strong>
                        <div className="muted small">
                          {c.suburb ?? 'QLD'}
                          {c.holes ? ` · ${c.holes.filter((h) => h.g).length} greens mapped` : ' · greens not mapped yet'}
                        </div>
                      </div>
                      <span>›</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {catalog && q.trim().length >= 2 && matches.length === 0 && (
            <p className="muted small">Not in the built-in South East Queensland list.</p>
          )}
          <div className="row gap wrap">
            <button className="btn" onClick={findNear}>
              📍 Near me
            </button>
            {q.trim().length >= 3 && (
              <button className="btn ghost" onClick={() => run('Searching online…', () => searchCourses(q))}>
                🌐 Search all of Australia
              </button>
            )}
            <button className="btn ghost" onClick={createBlank}>
              + Add manually
            </button>
          </div>
          {busy && <p className="muted">{busy}</p>}
          {error && <p className="error">{error}</p>}
          {nearby && (
            <ul className="list">
              {nearby.map((c) => (
                <li key={c.ref}>
                  <button className="list-btn" onClick={() => chooseBuiltIn(c)}>
                    <div>
                      <strong>{c.name}</strong>
                      <div className="muted small">
                        {c.suburb ?? 'QLD'}
                        {c.holes ? '' : ' · greens not mapped yet'}
                      </div>
                    </div>
                    <span className="muted small">{c.km.toFixed(1)} km</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
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
          {catalog && (
            <p className="muted small">
              {catalog.courses.length} South East Queensland courses built in (updated {catalog.generated || 'soon'}).
            </p>
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
