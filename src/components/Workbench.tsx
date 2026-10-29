'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { JobSummary, JobFull, JobState } from '@/lib/jobs';
import type { SearchView } from '@/lib/searches';
import { Highlight, Meter, TagInput, api, timeAgo, tokens, useToast } from './bits';

type Tab = 'inbox' | 'saved' | 'applied' | 'dismissed' | 'all';
type Sort = 'newest' | 'score' | 'company';
const TAB_STATE: Record<Exclude<Tab, 'all'>, JobState> = { inbox: 'new', saved: 'saved', applied: 'applied', dismissed: 'dismissed' };
const TAB_LABEL: Record<Tab, string> = { inbox: 'Inbox', saved: 'Saved', applied: 'Applied', dismissed: 'Dismissed', all: 'All' };

const claudeLink = (prompt: string) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;

function lsList(key: string): string[] {
  try {
    const v = JSON.parse(ls(key) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function ls(key: string, value?: string): string {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

export function Workbench() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>('inbox');
  const [text, setText] = useState('');
  const [srcFilter, setSrcFilter] = useState<Set<string>>(new Set());
  const [minScore, setMinScore] = useState(0);
  const [within, setWithin] = useState(0);
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [salaryOnly, setSalaryOnly] = useState(false);
  const [unscored, setUnscored] = useState(false);
  const [sort, setSort] = useState<Sort>('newest');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobFull | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [help, setHelp] = useState(false);
  const { show, node: toastNode } = useToast();
  const filterRef = useRef<HTMLInputElement>(null);
  const undoRef = useRef<{ id: string; prev: JobState } | null>(null);

  // search form
  const [kw, setKw] = useState<string[]>([]);
  const [loc, setLoc] = useState<string[]>([]);
  const [titleIdeas, setTitleIdeas] = useState<string[]>([]);
  const [remote, setRemote] = useState(false);
  const [days, setDays] = useState(7);
  const [sources, setSources] = useState<{ id: string; label: string; enabled: boolean }[]>([]);
  const [pickedSources, setPickedSources] = useState<Set<string>>(new Set());
  const [apifyOk, setApifyOk] = useState(true);
  const [search, setSearch] = useState<SearchView | null>(null);
  const [searchError, setSearchError] = useState('');
  const [starting, setStarting] = useState(false);
  const [, setTick] = useState(0);
  const lastKeywords = useRef('');

  const loadJobs = useCallback(async () => {
    try {
      const r = await api<{ jobs: JobSummary[] }>('/api/jobs');
      setJobs(r.jobs);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Could not load jobs.');
    } finally {
      setLoaded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadJobs();
    setKw(lsList('jh.kw2'));
    setLoc(lsList('jh.loc2'));
    api<{ sources: any[]; apifyTokenSet: boolean }>('/api/sources')
      .then((r) => {
        setSources(r.sources);
        setPickedSources(new Set(r.sources.filter((s) => s.enabled).map((s) => s.id)));
        setApifyOk(r.apifyTokenSet);
      })
      .catch(() => {});
    api<{ basics: { location: string; headline: string }; jobTitles?: string[] }>('/api/profile')
      .then((p) => {
        if (!ls('jh.loc2') && p.basics.location) setLoc([p.basics.location]);
        setTitleIdeas(p.jobTitles ?? []);
      })
      .catch(() => {});
  }, [loadJobs]);

  // ---------- searching ----------
  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!kw.length) {
      setSearchError('Enter a role or skills to search for.');
      return;
    }
    setSearchError('');
    setStarting(true);
    ls('jh.kw2', JSON.stringify(kw));
    ls('jh.loc2', JSON.stringify(loc));
    lastKeywords.current = kw.join(' ');
    try {
      const sv = await api<SearchView>('/api/searches', {
        method: 'POST',
        json: { keywords: kw, location: loc, remote, days: days || null, sources: [...pickedSources] },
      });
      setSearch(sv);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setStarting(false);
    }
  }

  useEffect(() => {
    if (!search || search.status !== 'running') return;
    const poll = setInterval(async () => {
      try {
        const sv = await api<SearchView>(`/api/searches/${search.id}`);
        setSearch(sv);
        if (sv.status !== 'running') {
          await loadJobs();
          show(sv.added ? `${sv.added} new job${sv.added === 1 ? '' : 's'} from ${sv.found} found.` : `Search finished. ${sv.found} found, none new.`);
        }
      } catch {
        /* keep polling */
      }
    }, 3000);
    const tick = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search?.id, search?.status]);

  // ---------- derived list ----------
  const terms = useMemo(() => [...new Set([...tokens(text), ...tokens(lastKeywords.current)])], [text, search]);
  const tabCounts = useMemo(() => {
    const c: Record<Tab, number> = { inbox: 0, saved: 0, applied: 0, dismissed: 0, all: 0 };
    for (const j of jobs) {
      c.all++;
      if (j.state === 'new') c.inbox++;
      else if (j.state === 'saved') c.saved++;
      else if (j.state === 'applied') c.applied++;
      else c.dismissed++;
    }
    return c;
  }, [jobs]);
  const sourceIds = useMemo(() => [...new Set(jobs.map((j) => j.source))], [jobs]);

  const visible = useMemo(() => {
    const t = tokens(text);
    const cutoff = within ? Date.now() - within * 86400e3 : 0;
    const out = jobs.filter((j) => {
      if (tab !== 'all' && j.state !== TAB_STATE[tab]) return false;
      if (tab === 'all' && j.state === 'dismissed') return false;
      if (srcFilter.size && !srcFilter.has(j.source)) return false;
      if (minScore && (j.score ?? -1) < minScore) return false;
      if (unscored && j.score != null) return false;
      if (remoteOnly && !j.remote) return false;
      if (salaryOnly && !j.salary) return false;
      if (cutoff && new Date(j.posted_at ?? j.first_seen ?? 0).getTime() < cutoff) return false;
      if (t.length) {
        const hay = `${j.title} ${j.company} ${j.location} ${j.tags.join(' ')} ${j.snippet}`.toLowerCase();
        if (!t.every((x) => hay.includes(x))) return false;
      }
      return true;
    });
    const when = (j: JobSummary) => new Date(j.posted_at ?? j.first_seen ?? 0).getTime();
    out.sort((a, b) =>
      sort === 'score'
        ? (b.score ?? -1) - (a.score ?? -1) || when(b) - when(a)
        : sort === 'company'
          ? a.company.localeCompare(b.company) || when(b) - when(a)
          : when(b) - when(a),
    );
    return out;
  }, [jobs, tab, text, srcFilter, minScore, within, remoteOnly, salaryOnly, unscored, sort]);

  const filtersActive = !!(text || srcFilter.size || minScore || within || remoteOnly || salaryOnly || unscored);
  function resetFilters() {
    setText('');
    setSrcFilter(new Set());
    setMinScore(0);
    setWithin(0);
    setRemoteOnly(false);
    setSalaryOnly(false);
    setUnscored(false);
  }

  // keep a valid selection
  useEffect(() => {
    if (!visible.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !visible.some((j) => j.id === selectedId)) setSelectedId(visible[0].id);
  }, [visible, selectedId]);

  // detail
  const cache = useRef(new Map<string, JobFull>());
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    const hit = cache.current.get(selectedId);
    if (hit) setDetail(hit);
    else setDetail(null);
    let cancelled = false;
    api<JobFull>(`/api/jobs/${selectedId}`)
      .then((d) => {
        cache.current.set(d.id, d);
        if (!cancelled) setDetail(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedId, jobs]);

  const selected = jobs.find((j) => j.id === selectedId) ?? null;

  // ---------- actions ----------
  async function setState(id: string, state: JobState, announce = true) {
    const job = jobs.find((j) => j.id === id);
    if (!job || job.state === state) return;
    const prev = job.state;
    const idx = visible.findIndex((j) => j.id === id);
    const next = visible[idx + 1]?.id ?? visible[idx - 1]?.id ?? null;
    undoRef.current = { id, prev };
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, state } : j)));
    cache.current.delete(id);
    const hidden = tab !== 'all' && TAB_STATE[tab] !== state;
    if (hidden && id === selectedId) setSelectedId(next);
    try {
      await api(`/api/jobs/${id}`, { method: 'PATCH', json: { state } });
      if (announce) show(state === 'dismissed' ? 'Dismissed.' : state === 'saved' ? 'Saved.' : state === 'applied' ? 'Marked as applied.' : 'Moved to inbox.', () => revert(id, prev));
    } catch (e) {
      setJobs((js) => js.map((j) => (j.id === id ? { ...j, state: prev } : j)));
      show(e instanceof Error ? e.message : 'Could not update the job.');
    }
  }
  function revert(id: string, prev: JobState) {
    setState(id, prev, false);
    setSelectedId(id);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) {
        if (e.key === 'Escape') (t as HTMLElement).blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = visible.findIndex((j) => j.id === selectedId);
      const go = (n: number) => {
        const j = visible[Math.min(visible.length - 1, Math.max(0, n))];
        if (j) {
          setSelectedId(j.id);
          document.getElementById(`job-${j.id}`)?.scrollIntoView({ block: 'nearest' });
        }
      };
      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          go(idx + 1);
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          go(idx - 1);
          break;
        case 'Enter':
          setDetailOpen(true);
          break;
        case 's':
          if (selected) setState(selected.id, selected.state === 'saved' ? 'new' : 'saved');
          break;
        case 'x':
          if (selected) setState(selected.id, 'dismissed');
          break;
        case 'a':
          if (selected) setState(selected.id, 'applied');
          break;
        case 'o':
          if (selected?.url) window.open(selected.url, '_blank', 'noopener');
          break;
        case 'u':
          if (undoRef.current) revert(undoRef.current.id, undoRef.current.prev);
          break;
        case '/':
          e.preventDefault();
          filterRef.current?.focus();
          break;
        case '?':
          setHelp((h) => !h);
          break;
        case 'Escape':
          setDetailOpen(false);
          setHelp(false);
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const elapsed = (iso: string | null) => {
    if (!iso) return '';
    const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  return (
    <div className="wb">
      {/* ---------- rail ---------- */}
      <aside className="rail" aria-label="Search and filters">
        <h2>Find new jobs</h2>
        {!apifyOk && (
          <p className="notice">
            Searching needs an Apify token. Add <code>APIFY_TOKEN</code> to the environment and redeploy.
          </p>
        )}
        <form onSubmit={runSearch}>
          <label className="field" htmlFor="kw" style={{ marginTop: 0 }}>
            Roles or skills
          </label>
          <TagInput id="kw" values={kw} onChange={setKw} placeholder="machine learning engineer" suggestions={titleIdeas} />
          <label className="field" htmlFor="loc">
            Places
          </label>
          <TagInput id="loc" values={loc} onChange={setLoc} placeholder="Bangalore, India" />
          {kw.length * Math.max(1, loc.length) > 1 && (
            <p className="hint">
              {kw.length * Math.max(1, loc.length)} searches per source (every role in every place).
            </p>
          )}
          <label className="field" htmlFor="days">
            Posted
          </label>
          <select id="days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>Last 24 hours</option>
            <option value={3}>Last 3 days</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={0}>Any time</option>
          </select>
          <label className="check">
            <input type="checkbox" checked={remote} onChange={(e) => setRemote(e.target.checked)} /> Remote only
          </label>
          {sources.length > 0 && (
            <div className="row" role="group" aria-label="Sources to search">
              {sources
                .filter((s) => s.enabled)
                .map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    className="chip"
                    aria-pressed={pickedSources.has(s.id)}
                    onClick={() =>
                      setPickedSources((p) => {
                        const n = new Set(p);
                        n.has(s.id) ? n.delete(s.id) : n.add(s.id);
                        return n;
                      })
                    }
                  >
                    {s.label}
                  </button>
                ))}
            </div>
          )}
          {searchError && (
            <p className="err" role="alert">
              {searchError}
            </p>
          )}
          <p>
            <button className="btn primary" disabled={starting || search?.status === 'running' || !pickedSources.size}>
              {starting ? 'Starting…' : search?.status === 'running' ? 'Searching…' : 'Search'}
            </button>
          </p>
        </form>
        {search && (
          <ul className="runs" aria-live="polite">
            {search.runs.map((r) => (
              <li key={r.id}>
                <span className="st">{sources.find((s) => s.id === r.source)?.label ?? r.source}</span>
                {(r.keywords || r.location) && <span className="hint"> · {[r.keywords, r.location].filter(Boolean).join(' in ')}</span>}{' '}
                {r.status === 'running' || r.status === 'ingesting' ? (
                  <span>running… {elapsed(r.started_at)}</span>
                ) : r.status === 'done' ? (
                  <span className="st done">
                    {r.found} found, {r.added} new
                  </span>
                ) : (
                  <span className="st failed">failed</span>
                )}
                {r.error && <div className="err" style={{ fontWeight: 400 }}>{r.error}</div>}
              </li>
            ))}
          </ul>
        )}

        <h2>Filters</h2>
        <label className="field" htmlFor="minscore" style={{ marginTop: 0 }}>
          Fit score
        </label>
        <select id="minscore" value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}>
          <option value={0}>Any</option>
          <option value={50}>50 or more</option>
          <option value={70}>70 or more</option>
          <option value={80}>80 or more</option>
        </select>
        <label className="field" htmlFor="within">
          Posted
        </label>
        <select id="within" value={within} onChange={(e) => setWithin(Number(e.target.value))}>
          <option value={0}>Any time</option>
          <option value={1}>Last 24 hours</option>
          <option value={3}>Last 3 days</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
        </select>
        {sourceIds.length > 1 && (
          <>
            <label className="field">Source</label>
            <div className="row">
              {sourceIds.map((s) => (
                <button
                  key={s}
                  className="chip"
                  aria-pressed={srcFilter.has(s)}
                  onClick={() =>
                    setSrcFilter((p) => {
                      const n = new Set(p);
                      n.has(s) ? n.delete(s) : n.add(s);
                      return n;
                    })
                  }
                >
                  {sources.find((x) => x.id === s)?.label ?? s}
                </button>
              ))}
            </div>
          </>
        )}
        <label className="check" style={{ marginTop: '0.7rem' }}>
          <input type="checkbox" checked={remoteOnly} onChange={(e) => setRemoteOnly(e.target.checked)} /> Remote only
        </label>
        <label className="check">
          <input type="checkbox" checked={salaryOnly} onChange={(e) => setSalaryOnly(e.target.checked)} /> Shows a salary
        </label>
        <label className="check">
          <input type="checkbox" checked={unscored} onChange={(e) => setUnscored(e.target.checked)} /> Not scored yet
        </label>
        {filtersActive && (
          <p>
            <button className="btn small" onClick={resetFilters}>
              Clear filters
            </button>
          </p>
        )}
        <p className="hint" style={{ marginTop: '1.2rem' }}>
          <button className="btn quiet small" onClick={() => setHelp(true)}>
            Keyboard shortcuts <kbd>?</kbd>
          </button>
        </p>
      </aside>

      {/* ---------- list ---------- */}
      <section className="listpane" aria-label="Jobs">
        <div className="listhead">
          <div className="filterbar">
            <input
              ref={filterRef}
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Filter by title, company, place or skill   ( / )"
              aria-label="Filter jobs"
            />
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
              <option value="newest">Newest</option>
              <option value="score">Best fit</option>
              <option value="company">Company</option>
            </select>
            <button className="btn small" onClick={() => setAdding(true)}>
              Add a posting
            </button>
          </div>
          <div className="tabs" role="tablist">
            {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                {TAB_LABEL[t]}
                <span className="n">{tabCounts[t]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="list" role="listbox" aria-label="Job results">
          {!loaded ? (
            <div className="empty">Loading…</div>
          ) : visible.length === 0 ? (
            <div className="empty">
              {jobs.length === 0 ? (
                <>
                  <h3>No jobs yet</h3>
                  <p>Run a search on the left, or ask Claude: “Find machine learning engineer jobs in Bangalore from the last week.”</p>
                </>
              ) : (
                <>
                  <h3>Nothing matches</h3>
                  <p>
                    {filtersActive ? 'Your filters hide everything in this tab.' : `The ${TAB_LABEL[tab].toLowerCase()} tab is empty.`}{' '}
                    {filtersActive && (
                      <button className="btn small" onClick={resetFilters}>
                        Clear filters
                      </button>
                    )}
                  </p>
                </>
              )}
            </div>
          ) : (
            visible.map((j) => (
              <button
                id={`job-${j.id}`}
                key={j.id}
                role="option"
                aria-selected={j.id === selectedId}
                className={`row-job${j.state === 'dismissed' ? ' dim' : ''}`}
                onClick={() => {
                  setSelectedId(j.id);
                  setDetailOpen(true);
                }}
              >
                <Meter score={j.score} />
                <span style={{ minWidth: 0 }}>
                  <span className="rj-title">
                    <Highlight text={j.title} terms={terms} />
                  </span>
                  <span className="rj-sub">
                    <Highlight text={j.company} terms={terms} />
                    {j.location ? ' · ' : ''}
                    <Highlight text={j.location} terms={terms} />
                    {j.remote && !/remote/i.test(j.location) ? ' · Remote' : ''}
                    {j.salary ? ` · ${j.salary}` : ''}
                  </span>
                </span>
                <span className="rj-side">
                  <span>{timeAgo(j.posted_at ?? j.first_seen)}</span>
                  {j.score != null ? <b>{j.score}</b> : <span className="tag">{sources.find((s) => s.id === j.source)?.label ?? j.source}</span>}
                </span>
              </button>
            ))
          )}
        </div>
      </section>

      {/* ---------- detail ---------- */}
      <article className={`detail${detailOpen ? ' open' : ''}`} aria-label="Job details">
        <button className="btn small quiet" style={{ display: 'none' }} id="close-detail" onClick={() => setDetailOpen(false)}>
          Back
        </button>
        <style>{`@media (max-width:1100px){#close-detail{display:inline-flex !important;margin-bottom:.6rem}}`}</style>
        {!selected ? (
          <div className="empty">Select a job to read it here.</div>
        ) : (
          <>
            <h2>
              <Highlight text={selected.title} terms={terms} />
            </h2>
            <p className="co">
              {selected.company} {selected.location && `· ${selected.location}`}
            </p>
            <div className="facts">
              {selected.posted_at && <span>Posted {timeAgo(selected.posted_at)} ago</span>}
              {selected.salary && <span>{selected.salary}</span>}
              {selected.employment_type && <span>{selected.employment_type}</span>}
              {selected.seniority && <span>{selected.seniority}</span>}
              {selected.remote && <span>Remote</span>}
              <span className="tag">{sources.find((s) => s.id === selected.source)?.label ?? selected.source}</span>
            </div>
            <div className="actions">
              <button className={`btn${selected.state === 'saved' ? ' primary' : ''}`} onClick={() => setState(selected.id, selected.state === 'saved' ? 'new' : 'saved')}>
                {selected.state === 'saved' ? 'Saved' : 'Save'} <kbd>s</kbd>
              </button>
              <button className="btn" onClick={() => setState(selected.id, selected.state === 'dismissed' ? 'new' : 'dismissed')}>
                {selected.state === 'dismissed' ? 'Restore' : 'Dismiss'} <kbd>x</kbd>
              </button>
              <button className="btn" onClick={() => setState(selected.id, 'applied')} disabled={selected.state === 'applied'}>
                {selected.state === 'applied' ? 'Applied' : 'Mark applied'} <kbd>a</kbd>
              </button>
              {selected.url && (
                <a className="btn" href={selected.url} target="_blank" rel="noopener noreferrer">
                  Open posting <kbd>o</kbd>
                </a>
              )}
            </div>
            <p>
              <a
                className="btn primary"
                target="_blank"
                rel="noopener noreferrer"
                href={claudeLink(
                  `Using my Jobhunt connector: read my profile and job ${selected.id} (${selected.title} at ${selected.company}), write a tailored resume and cover letter using only facts from my profile, check the draft, and save it as an application. List any gaps.`,
                )}
              >
                Draft with Claude
              </a>
            </p>

            <div className="fit">
              {detail?.score != null ? (
                <>
                  <b className="num">{detail.score}</b> <span className="hint">fit, scored by Claude</span>
                  {detail.score_reasons.length > 0 && (
                    <ul>
                      {detail.score_reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                      {detail.score_flags.map((r, i) => (
                        <li key={`f${i}`} className="flag">
                          {r}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="hint" style={{ margin: 0 }}>
                  Not scored yet.{' '}
                  <a
                    target="_blank"
                    rel="noopener noreferrer"
                    href={claudeLink(`Using my Jobhunt connector, read my profile and score job ${selected.id} (${selected.title} at ${selected.company}) for fit, with reasons and red flags, and save the score.`)}
                  >
                    Ask Claude to score it
                  </a>
                </p>
              )}
            </div>

            {detail && detail.applications.length > 0 && (
              <p>
                {detail.applications.map((a) => (
                  <Link key={a.id} href={`/applications/${a.id}`} className="btn small" style={{ marginRight: 6 }}>
                    Application · {a.status}
                  </Link>
                ))}
              </p>
            )}

            {detail && detail.description.length < 400 && (
              <p className="notice">
                This source returned only a short description. For a better draft, open the posting, copy the full text, and use <b>Add a posting</b>.
              </p>
            )}
            <div className="desc">
              <Highlight text={detail?.description ?? selected.snippet} terms={terms} />
            </div>

            <label className="field" htmlFor="notes">
              Your notes
            </label>
            <textarea
              key={selected.id}
              id="notes"
              rows={3}
              defaultValue={detail?.notes ?? ''}
              placeholder="Private notes. Claude can read these through get_job, so keep anything sensitive elsewhere."
              onBlur={(e) => {
                if (e.target.value !== (detail?.notes ?? '')) {
                  api(`/api/jobs/${selected.id}`, { method: 'PATCH', json: { notes: e.target.value } }).then(() => cache.current.delete(selected.id)).catch(() => show('Could not save notes.'));
                }
              }}
            />
          </>
        )}
      </article>

      {adding && (
        <AddPosting
          onClose={() => setAdding(false)}
          onAdded={async (id) => {
            setAdding(false);
            cache.current.clear();
            await loadJobs();
            setTab('inbox');
            resetFilters();
            setSelectedId(id);
            show('Posting added.');
          }}
        />
      )}
      {help && (
        <div className="dialog-back" onClick={() => setHelp(false)}>
          <div className="dialog" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
            <h2>Keyboard shortcuts</h2>
            <p>
              <kbd>j</kbd> <kbd>k</kbd> next and previous job
              <br />
              <kbd>s</kbd> save or unsave &nbsp; <kbd>x</kbd> dismiss &nbsp; <kbd>a</kbd> mark applied
              <br />
              <kbd>o</kbd> open the posting &nbsp; <kbd>u</kbd> undo the last change
              <br />
              <kbd>/</kbd> filter the list &nbsp; <kbd>Esc</kbd> leave a field or close
            </p>
            <button className="btn" onClick={() => setHelp(false)}>
              Close
            </button>
          </div>
        </div>
      )}
      {toastNode}
    </div>
  );
}

function AddPosting({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string) => void }) {
  const [f, setF] = useState({ title: '', company: '', url: '', location: '', description: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="dialog-back" onClick={onClose}>
      <form
        className="dialog"
        role="dialog"
        aria-label="Add a posting"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr('');
          try {
            const r = await api<{ id: string }>('/api/jobs', { method: 'POST', json: { ...f, url: f.url || undefined, location: f.location || undefined } });
            onAdded(r.id);
          } catch (x) {
            setErr(x instanceof Error ? x.message : 'Could not add the posting.');
            setBusy(false);
          }
        }}
      >
        <h2>Add a posting</h2>
        <p className="hint">Paste a job you found yourself, or the full text of one a scraper only partly captured.</p>
        <div className="grid2">
          <div>
            <label className="field" htmlFor="ap-title">Job title</label>
            <input id="ap-title" type="text" value={f.title} onChange={set('title')} required autoFocus />
          </div>
          <div>
            <label className="field" htmlFor="ap-co">Company</label>
            <input id="ap-co" type="text" value={f.company} onChange={set('company')} required />
          </div>
          <div>
            <label className="field" htmlFor="ap-loc">Place</label>
            <input id="ap-loc" type="text" value={f.location} onChange={set('location')} />
          </div>
          <div>
            <label className="field" htmlFor="ap-url">Link</label>
            <input id="ap-url" type="text" value={f.url} onChange={set('url')} placeholder="https://…" />
          </div>
        </div>
        <label className="field" htmlFor="ap-desc">Full posting text</label>
        <textarea id="ap-desc" rows={10} value={f.description} onChange={set('description')} required minLength={20} />
        {err && <p className="err" role="alert">{err}</p>}
        <p style={{ display: 'flex', gap: 8 }}>
          <button className="btn primary" disabled={busy}>{busy ? 'Adding…' : 'Add posting'}</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </p>
      </form>
    </div>
  );
}
