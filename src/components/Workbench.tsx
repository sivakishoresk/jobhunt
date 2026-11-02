'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { JobSummary, JobFull, JobState } from '@/lib/jobs';
import type { SearchView } from '@/lib/searches';
import { Highlight, Meter, TagInput, api, timeAgo, tokens, useToast } from './bits';
import { yearsLabel, LINKEDIN_LEVELS } from '@/lib/experience';
import { termsText } from '@/lib/terms';

type Tab = 'inbox' | 'saved' | 'applied' | 'dismissed' | 'all';
type Sort = 'newest' | 'score' | 'company';
const TAB_STATE: Record<Exclude<Tab, 'all'>, JobState> = { inbox: 'new', saved: 'saved', applied: 'applied', dismissed: 'dismissed' };
const TAB_LABEL: Record<Tab, string> = { inbox: 'Inbox', saved: 'Saved', applied: 'Applied', dismissed: 'Dismissed', all: 'All' };

function toggle<T>(set: Set<T>, v: T): Set<T> {
  const n = new Set(set);
  n.has(v) ? n.delete(v) : n.add(v);
  return n;
}
function levelText(codes?: number[]): string {
  return (codes ?? []).map((c) => LINKEDIN_LEVELS.find((l) => l.code === c)?.label ?? '').filter(Boolean).join('/');
}
function searchTitle(sx: SearchView): string {
  return `${termsText(sx.query.keywords)}${termsText(sx.query.location) ? ' in ' + termsText(sx.query.location) : ''}`;
}

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
  const [yrsFrom, setYrsFrom] = useState('');
  const [yrsTo, setYrsTo] = useState('');
  const [yrsUnstated, setYrsUnstated] = useState(true);
  const [pastSearches, setPastSearches] = useState<SearchView[]>([]);
  const [scopeId, setScopeId] = useState<string>('all');
  const [scopeIds, setScopeIds] = useState<Set<string> | null>(null);
  const [newOnly, setNewOnly] = useState(false);
  const [scopeReady, setScopeReady] = useState(false);
  const [scopeLoading, setScopeLoading] = useState(false);
  // Which role / place run found each job, for searches that covered several of either.
  const [attr, setAttr] = useState<{ roles: string[]; places: string[]; byJob: Map<string, [number, number][]> } | null>(null);
  const [roleSel, setRoleSel] = useState<Set<number>>(new Set());
  const [placeSel, setPlaceSel] = useState<Set<number>>(new Set());
  const [levelSel, setLevelSel] = useState<Set<string>>(new Set());
  const [levels, setLevels] = useState<Set<number>>(new Set());
  const [sort, setSort] = useState<Sort>('newest');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobFull | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
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

  const loadSearches = useCallback(async (): Promise<SearchView[]> => {
    try {
      const r = await api<{ searches: SearchView[] }>('/api/searches');
      setPastSearches(r.searches);
      return r.searches;
    } catch {
      return [];
    }
  }, []);

  const selectScope = useCallback(async (id: string) => {
    setScopeId(id);
    setNewOnly(false);
    setRoleSel(new Set());
    setPlaceSel(new Set());
    setLevelSel(new Set());
    setAttr(null);
    ls('jh.scope', id);
    if (id === 'all') {
      setScopeIds(null);
      setScopeLoading(false);
      return;
    }
    setScopeLoading(true);
    try {
      const r = await api<{ ids: string[]; roles: string[]; places: string[]; rows: [string, number, number][] }>(`/api/searches/${id}/jobs`);
      setScopeIds(new Set(r.ids));
      if (r.rows.length) {
        const byJob = new Map<string, [number, number][]>();
        for (const [jid, ri, pi] of r.rows) byJob.set(jid, [...(byJob.get(jid) ?? []), [ri, pi]]);
        setAttr({ roles: r.roles, places: r.places, byJob });
      }
    } catch {
      setScopeIds(new Set());
    } finally {
      setScopeLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
    loadSearches().then((list) => {
      const stored = ls('jh.scope');
      const want = stored === 'all' ? 'all' : list.find((x) => x.id === stored)?.id ?? list.find((x) => x.jobs > 0)?.id ?? 'all';
      selectScope(want).finally(() => setScopeReady(true));
    });
    try {
      setLevels(new Set(JSON.parse(ls('jh.levels') || '[]')));
    } catch {}
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
  }, [loadJobs, loadSearches, selectScope]);

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
    ls('jh.levels', JSON.stringify([...levels]));
    lastKeywords.current = kw.join(' ');
    try {
      const sv = await api<SearchView>('/api/searches', {
        method: 'POST',
        json: { keywords: kw, location: loc, remote, days: days || null, experience: [...levels].sort(), sources: [...pickedSources] },
      });
      setSearch(sv);
      setNewOpen(false);
      loadSearches();
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
          await loadSearches();
          await selectScope(sv.id);
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
  const scopeSearch = useMemo(() => pastSearches.find((x) => x.id === scopeId) ?? null, [pastSearches, scopeId]);
  const scoped = useMemo(() => {
    if (scopeLoading) return [];
    if (!scopeIds) return jobs;
    const since = newOnly ? scopeSearch?.created_at ?? null : null;
    return jobs.filter((j) => scopeIds.has(j.id) && (!since || (j.first_seen != null && j.first_seen >= since)));
  }, [jobs, scopeIds, newOnly, scopeSearch, scopeLoading]);
  // Chip options for the role / place / level filters, counted over the jobs in this view.
  const facets = useMemo(() => {
    const live = scoped.filter((j) => j.state !== 'dismissed');
    const roleN = new Map<number, number>();
    const placeN = new Map<number, number>();
    if (attr) {
      for (const j of live) {
        const pairs = attr.byJob.get(j.id) ?? [];
        for (const ri of new Set(pairs.map((x) => x[0]))) roleN.set(ri, (roleN.get(ri) ?? 0) + 1);
        for (const pi of new Set(pairs.map((x) => x[1]))) placeN.set(pi, (placeN.get(pi) ?? 0) + 1);
      }
    }
    const levelN = new Map<string, number>();
    for (const j of live) levelN.set(j.seniority ?? '', (levelN.get(j.seniority ?? '') ?? 0) + 1);
    return { roleN, placeN, levelN };
  }, [scoped, attr]);
  const terms = useMemo(() => [...new Set([...tokens(text), ...tokens(lastKeywords.current)])], [text, search]);
  const tabCounts = useMemo(() => {
    const c: Record<Tab, number> = { inbox: 0, saved: 0, applied: 0, dismissed: 0, all: 0 };
    for (const j of scoped) {
      c.all++;
      if (j.state === 'new') c.inbox++;
      else if (j.state === 'saved') c.saved++;
      else if (j.state === 'applied') c.applied++;
      else c.dismissed++;
    }
    return c;
  }, [scoped]);
  const sourceIds = useMemo(() => [...new Set(jobs.map((j) => j.source))], [jobs]);

  const visible = useMemo(() => {
    const t = tokens(text);
    const cutoff = within ? Date.now() - within * 86400e3 : 0;
    const lo = yrsFrom === '' ? null : Number(yrsFrom);
    const hi = yrsTo === '' ? null : Number(yrsTo);
    const out = scoped.filter((j) => {
      if (lo != null || hi != null) {
        if (j.min_years == null) {
          if (!yrsUnstated) return false;
        } else if ((lo != null && j.min_years < lo) || (hi != null && j.min_years > hi)) return false;
      }
      if (attr && (roleSel.size || placeSel.size)) {
        const pairs = attr.byJob.get(j.id) ?? [];
        if (!pairs.some(([ri, pi]) => (!roleSel.size || roleSel.has(ri)) && (!placeSel.size || placeSel.has(pi)))) return false;
      }
      if (levelSel.size && !levelSel.has(j.seniority ?? '')) return false;
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
  }, [scoped, attr, roleSel, placeSel, levelSel, tab, text, srcFilter, minScore, within, remoteOnly, salaryOnly, unscored, yrsFrom, yrsTo, yrsUnstated, sort]);

  const filtersActive = !!(text || srcFilter.size || minScore || within || remoteOnly || salaryOnly || unscored || yrsFrom !== '' || yrsTo !== '' || roleSel.size > 0 || placeSel.size > 0 || levelSel.size > 0);
  function resetFilters() {
    setText('');
    setSrcFilter(new Set());
    setMinScore(0);
    setWithin(0);
    setRemoteOnly(false);
    setSalaryOnly(false);
    setUnscored(false);
    setYrsFrom('');
    setYrsTo('');
    setYrsUnstated(true);
    setRoleSel(new Set());
    setPlaceSel(new Set());
    setLevelSel(new Set());
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
          setNewOpen(false);
          setFiltersOpen(false);
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

  const activeChips: { key: string; label: string; clear: () => void }[] = [];
  if (attr) {
    roleSel.forEach((i) => activeChips.push({ key: `r${i}`, label: `Role: ${attr.roles[i] || 'Any'}`, clear: () => setRoleSel((p) => toggle(p, i)) }));
    placeSel.forEach((i) => activeChips.push({ key: `p${i}`, label: `Place: ${attr.places[i] || 'Anywhere'}`, clear: () => setPlaceSel((p) => toggle(p, i)) }));
  }
  levelSel.forEach((lv) => activeChips.push({ key: `l${lv}`, label: `Level: ${lv || 'Not stated'}`, clear: () => setLevelSel((p) => toggle(p, lv)) }));
  srcFilter.forEach((s) => activeChips.push({ key: `s${s}`, label: `Source: ${sources.find((x) => x.id === s)?.label ?? s}`, clear: () => setSrcFilter((p) => toggle(p, s)) }));
  if (minScore) activeChips.push({ key: 'ms', label: `Fit ${minScore}+`, clear: () => setMinScore(0) });
  if (within) activeChips.push({ key: 'wi', label: within === 1 ? 'Posted in 24 hours' : `Posted in ${within} days`, clear: () => setWithin(0) });
  if (yrsFrom !== '' || yrsTo !== '')
    activeChips.push({
      key: 'yr',
      label: `Asks ${yrsFrom === '' ? 'up to ' + yrsTo : yrsTo === '' ? yrsFrom + '+' : yrsFrom + '–' + yrsTo} yrs${yrsUnstated ? '' : ', stated only'}`,
      clear: () => {
        setYrsFrom('');
        setYrsTo('');
        setYrsUnstated(true);
      },
    });
  if (remoteOnly) activeChips.push({ key: 're', label: 'Remote only', clear: () => setRemoteOnly(false) });
  if (salaryOnly) activeChips.push({ key: 'sa', label: 'Shows a salary', clear: () => setSalaryOnly(false) });
  if (unscored) activeChips.push({ key: 'un', label: 'Not scored yet', clear: () => setUnscored(false) });

  const verdict = (n: number) => (n >= 80 ? 'Strong fit' : n >= 70 ? 'Good fit' : n >= 50 ? 'Possible fit' : 'Weak fit');
  const srcLabel = (id: string) => sources.find((s) => s.id === id)?.label ?? id;
  const scopeMeta = (sx: SearchView) =>
    [termsText(sx.query.location), sx.query.days ? `last ${sx.query.days === 1 ? '24 hours' : sx.query.days + ' days'}` : '', levelText(sx.query.experience)].filter(Boolean).join(' · ');
  const running = search?.status === 'running';

  return (
    <div className="wb">
      {/* ---------- searches ---------- */}
      <aside className="rail" aria-label="Searches">
        <div className="rail-head">
          <h2>
            Searches <small>{pastSearches.length} saved</small>
          </h2>
          <button className="btn primary block" onClick={() => setNewOpen(true)}>
            <svg className="ic" viewBox="0 0 24 24" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
            {running ? 'Searching…' : 'New search'}
          </button>
        </div>
        <div className="rail-scroll">
          {search && (
            <ul className="runs" aria-live="polite" aria-label="Current search">
              {search.runs.map((r) => (
                <li key={r.id}>
                  <span className="st">{srcLabel(r.source)}</span>
                  {(r.keywords || r.location) && <span className="hint"> · {[r.keywords, r.location].filter(Boolean).join(' in ')}</span>}{' '}
                  {r.status === 'running' || r.status === 'ingesting' ? (
                    <span>
                      <span className="pulse" aria-hidden /> running {elapsed(r.started_at)}
                    </span>
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
          <ul className="past" aria-label="Past searches">
            <li>
              <button className="past-item" aria-current={scopeId === 'all'} onClick={() => selectScope('all')}>
                <span className="pi-main">All jobs</span>
                <span className="pi-side">{jobs.length}</span>
                <span className="pi-sub">Everything you have collected</span>
              </button>
            </li>
            {pastSearches.map((sx) => (
              <li key={sx.id}>
                <button className="past-item" aria-current={scopeId === sx.id} onClick={() => selectScope(sx.id)} title={searchTitle(sx)}>
                  <span className="pi-main">{termsText(sx.query.keywords)}</span>
                  <span className="pi-side">{sx.status === 'running' ? <span className="pulse" aria-label="running" /> : sx.status === 'failed' ? 'failed' : sx.jobs}</span>
                  <span className="pi-sub">{scopeMeta(sx).replace(/last (\d+) days/, 'last $1d').replace('last 24 hours', 'last 24h') || 'Any place'}</span>
                  <span className="pi-foot">
                    <span>{timeAgo(sx.created_at)} ago</span>
                    {sx.added > 0 && <span className="pill-new">{sx.added} new</span>}
                    {sx.status === 'partial' && <span className="pill-bad">partial</span>}
                  </span>
                </button>
              </li>
            ))}
            {!pastSearches.length && <li className="hint">Searches you run appear here, each with its own listings.</li>}
          </ul>
        </div>
        <div className="rail-foot">
          <button className="btn quiet small" onClick={() => setHelp(true)}>
            Keyboard shortcuts <kbd>?</kbd>
          </button>
        </div>
      </aside>

      {/* ---------- list ---------- */}
      <section className="listpane" aria-label="Jobs">
        <div className="listhead">
          {scopeSearch ? (
            <div className="scope" role="status">
              <div>
                <h1>{termsText(scopeSearch.query.keywords)}</h1>
                <p className="meta">
                  {[
                    scopeMeta(scopeSearch),
                    new Date(scopeSearch.created_at ?? Date.now()).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }),
                    `${scopeSearch.jobs} listings${scopeSearch.added ? `, ${scopeSearch.added} new` : ''}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <div className="scope-actions">
                {scopeSearch.added > 0 && (
                  <label className="check">
                    <input type="checkbox" checked={newOnly} onChange={(e) => setNewOnly(e.target.checked)} /> Only new
                  </label>
                )}
                <button className="btn small" onClick={() => selectScope('all')}>
                  Show all jobs
                </button>
              </div>
            </div>
          ) : scopeId === 'all' && scopeReady ? (
            <div className="scope" role="status">
              <div>
                <h1>All jobs</h1>
                <p className="meta">
                  {jobs.length} listings from {pastSearches.length} search{pastSearches.length === 1 ? '' : 'es'}
                </p>
              </div>
            </div>
          ) : (
            <div className="scope hint">Loading search…</div>
          )}
          <div className="toolbar">
            <div className="search-box">
              <svg className="ic" viewBox="0 0 24 24" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" />
              </svg>
              <input
                ref={filterRef}
                type="search"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Filter by title, company, place or skill"
                aria-label="Filter jobs"
              />
            </div>
            <button className="btn filters-btn" aria-expanded={filtersOpen} aria-haspopup="dialog" onClick={() => setFiltersOpen((o) => !o)}>
              <svg className="ic" viewBox="0 0 24 24" aria-hidden>
                <path d="M4 6h16M7 12h10M10 18h4" />
              </svg>
              Filters
              {activeChips.length > 0 && <span className="count">{activeChips.length}</span>}
            </button>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
              <option value="newest">Newest</option>
              <option value="score">Best fit</option>
              <option value="company">Company</option>
            </select>
            <button className="btn" onClick={() => setAdding(true)}>
              Add a posting
            </button>
          </div>
          {activeChips.length > 0 && (
            <ul className="tag-list active-chips" aria-label="Active filters">
              {activeChips.map((c) => (
                <li key={c.key} className="tag">
                  {c.label}
                  <button aria-label={`Remove filter ${c.label}`} onClick={c.clear}>×</button>
                </li>
              ))}
              <li>
                <button className="btn quiet small" onClick={resetFilters}>
                  Clear all
                </button>
              </li>
            </ul>
          )}
          <div className="tabs" role="tablist">
            {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                {TAB_LABEL[t]}
                <span className="n">{tabCounts[t]}</span>
              </button>
            ))}
          </div>

          {filtersOpen && (
            <>
              <div className="pop-back" onClick={() => setFiltersOpen(false)} />
              <div className="filters-pop" role="dialog" aria-label="Filters">
                <div className="fgrid">
                  {attr && attr.roles.length > 1 && (
                    <div className="fgroup">
                      <h3>Role searched</h3>
                      <div className="row" role="group" aria-label="Role searched">
                        {attr.roles.map((r, i) => (
                          <button key={r + i} className="chip" aria-pressed={roleSel.has(i)} onClick={() => setRoleSel((p) => toggle(p, i))}>
                            {r || 'Any role'}
                            <span className="n">{facets.roleN.get(i) ?? 0}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {attr && attr.places.length > 1 && (
                    <div className="fgroup">
                      <h3>Place searched</h3>
                      <div className="row" role="group" aria-label="Place searched">
                        {attr.places.map((r, i) => (
                          <button key={r + i} className="chip" aria-pressed={placeSel.has(i)} onClick={() => setPlaceSel((p) => toggle(p, i))}>
                            {r || 'Anywhere'}
                            <span className="n">{facets.placeN.get(i) ?? 0}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {facets.levelN.size > 1 && (
                    <div className="fgroup">
                      <h3>Seniority</h3>
                      <div className="row" role="group" aria-label="Seniority">
                        {[...facets.levelN.entries()]
                          .sort((a, b) => b[1] - a[1])
                          .map(([lv, n]) => (
                            <button key={lv || 'none'} className="chip" aria-pressed={levelSel.has(lv)} onClick={() => setLevelSel((p) => toggle(p, lv))}>
                              {lv || 'Not stated'}
                              <span className="n">{n}</span>
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                  <div className="fgroup">
                    <h3>Years of experience asked</h3>
                    <div className="yrs">
                      <input type="number" min={0} max={40} inputMode="numeric" aria-label="From years" placeholder="from" value={yrsFrom} onChange={(e) => setYrsFrom(e.target.value)} />
                      <span aria-hidden>to</span>
                      <input type="number" min={0} max={40} inputMode="numeric" aria-label="To years" placeholder="to" value={yrsTo} onChange={(e) => setYrsTo(e.target.value)} />
                    </div>
                    <div className="row" style={{ marginTop: '0.5rem' }}>
                      {[
                        ['Entry 0–2', '0', '2'],
                        ['Mid 3–5', '3', '5'],
                        ['Senior 6+', '6', ''],
                      ].map(([label, a, b]) => (
                        <button
                          key={label}
                          type="button"
                          className="chip"
                          aria-pressed={yrsFrom === a && yrsTo === b}
                          onClick={() => {
                            const on = yrsFrom === a && yrsTo === b;
                            setYrsFrom(on ? '' : a);
                            setYrsTo(on ? '' : b);
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {(yrsFrom !== '' || yrsTo !== '') && (
                      <label className="check" style={{ marginTop: '0.5rem' }}>
                        <input type="checkbox" checked={yrsUnstated} onChange={(e) => setYrsUnstated(e.target.checked)} /> Keep postings that don&apos;t say
                      </label>
                    )}
                  </div>
                  <div className="fgroup">
                    <label className="field" htmlFor="minscore">
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
                  </div>
                  <div className="fgroup">
                    {sourceIds.length > 1 && (
                      <>
                        <h3>Source</h3>
                        <div className="row">
                          {sourceIds.map((s) => (
                            <button key={s} className="chip" aria-pressed={srcFilter.has(s)} onClick={() => setSrcFilter((p) => toggle(p, s))}>
                              {srcLabel(s)}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    <h3 style={{ marginTop: '0.9rem' }}>Show only</h3>
                    <label className="check">
                      <input type="checkbox" checked={remoteOnly} onChange={(e) => setRemoteOnly(e.target.checked)} /> Remote
                    </label>
                    <label className="check">
                      <input type="checkbox" checked={salaryOnly} onChange={(e) => setSalaryOnly(e.target.checked)} /> Shows a salary
                    </label>
                    <label className="check">
                      <input type="checkbox" checked={unscored} onChange={(e) => setUnscored(e.target.checked)} /> Not scored yet
                    </label>
                  </div>
                </div>
                <div className="fpop-foot">
                  <button className="btn quiet small" onClick={resetFilters} disabled={!filtersActive}>
                    Clear filters
                  </button>
                  <button className="btn primary small" onClick={() => setFiltersOpen(false)}>
                    Show {visible.length} job{visible.length === 1 ? '' : 's'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="list" role="listbox" aria-label="Job results">
          {!loaded || !scopeReady || scopeLoading ? (
            <div className="empty">Loading…</div>
          ) : visible.length === 0 ? (
            <div className="empty">
              {jobs.length === 0 ? (
                <>
                  <h3>No jobs yet</h3>
                  <p>Start with New search, or ask Claude: “Find machine learning engineer jobs in Bangalore from the last week.”</p>
                </>
              ) : scopeSearch && scopeSearch.jobs === 0 ? (
                <>
                  <h3>This search returned no listings</h3>
                  <p>
                    {scopeSearch.status === 'running'
                      ? 'It is still running. Results appear here when it finishes.'
                      : scopeSearch.status === 'failed' || scopeSearch.status === 'partial'
                        ? 'One or more sources failed. Check Settings → Sources and use Test to see why.'
                        : 'Try a wider posted window, fewer filters, or a different role.'}{' '}
                    <button className="btn small" onClick={() => selectScope('all')}>
                      Show all jobs
                    </button>
                  </p>
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
            visible.map((j) => {
              const yl = yearsLabel(j.min_years, j.max_years);
              return (
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
                  <span className="rj-body">
                    <span className="rj-title">
                      <Highlight text={j.title} terms={terms} />
                    </span>
                    <span className="rj-sub">
                      <Highlight text={j.company} terms={terms} />
                      {j.location ? ' · ' : ''}
                      <Highlight text={j.location} terms={terms} />
                    </span>
                    <span className="rj-meta">
                      {yl && <span className="pill yrs-pill">{yl}</span>}
                      {j.remote && <span className="pill">Remote</span>}
                      {j.salary && <span className="pill">{j.salary}</span>}
                      {j.seniority && <span className="pill">{j.seniority}</span>}
                      {j.state === 'saved' && <span className="pill">Saved</span>}
                      {j.state === 'applied' && <span className="pill">Applied</span>}
                    </span>
                  </span>
                  <span className="rj-side">
                    <span>{timeAgo(j.posted_at ?? j.first_seen)}</span>
                    {j.score != null ? <b>{j.score}</b> : <span className="src-mark">{srcLabel(j.source)}</span>}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </section>

      {/* ---------- reading pane ---------- */}
      <article className={`detail${detailOpen ? ' open' : ''}`} aria-label="Job details">
        <button className="btn small quiet back-btn" onClick={() => setDetailOpen(false)}>
          ← Back to list
        </button>
        {!selected ? (
          <div className="empty">
            <h3>Pick a job</h3>
            <p>Use <kbd>j</kbd> and <kbd>k</kbd> to move through the list. The posting opens here.</p>
          </div>
        ) : (
          <>
            {(selected.state === 'saved' || selected.state === 'applied' || selected.state === 'dismissed') && (
              <span className={`state-badge${selected.state === 'saved' ? ' saved' : ''}`}>
                {selected.state === 'saved' ? 'Saved' : selected.state === 'applied' ? 'Applied' : 'Dismissed'}
              </span>
            )}
            <h2>
              <Highlight text={selected.title} terms={terms} />
            </h2>
            <p className="co">
              {selected.company} {selected.location && `· ${selected.location}`}
            </p>
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
            <div className="cta">
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
            </div>

            <div className="fit">
              {detail?.score != null ? (
                <>
                  <div className="fit-top">
                    <b className="num">{detail.score}</b>
                    <span className="of">/ 100</span>
                    <span className="verdict">{verdict(detail.score)}</span>
                  </div>
                  <div className="ruler" aria-hidden>
                    <i style={{ width: `${Math.max(3, detail.score)}%` }} />
                  </div>
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
                <>
                  <div className="ruler empty-ruler" aria-hidden />
                  <p className="hint" style={{ margin: '0.8rem 0 0' }}>
                    Not scored yet.{' '}
                    <a
                      target="_blank"
                      rel="noopener noreferrer"
                      href={claudeLink(`Using my Jobhunt connector, read my profile and score job ${selected.id} (${selected.title} at ${selected.company}) for fit, with reasons and red flags, and save the score.`)}
                    >
                      Ask Claude to score it
                    </a>
                  </p>
                </>
              )}
            </div>

            <dl className="facts">
              {selected.posted_at && (
                <div>
                  <dt>Posted</dt>
                  <dd>{timeAgo(selected.posted_at)} ago</dd>
                </div>
              )}
              {yearsLabel(selected.min_years, selected.max_years) && (
                <div title="Read from the posting text. Where several are listed, the highest is shown.">
                  <dt>Experience asked</dt>
                  <dd>{yearsLabel(selected.min_years, selected.max_years)}</dd>
                </div>
              )}
              {selected.salary && (
                <div>
                  <dt>Salary</dt>
                  <dd>{selected.salary}</dd>
                </div>
              )}
              {selected.seniority && (
                <div>
                  <dt>Level</dt>
                  <dd>{selected.seniority}</dd>
                </div>
              )}
              {selected.employment_type && (
                <div>
                  <dt>Type</dt>
                  <dd>{selected.employment_type}</dd>
                </div>
              )}
              {selected.remote && (
                <div>
                  <dt>Work</dt>
                  <dd>Remote</dd>
                </div>
              )}
              <div>
                <dt>Source</dt>
                <dd>{srcLabel(selected.source)}</dd>
              </div>
            </dl>

            {detail && detail.applications.length > 0 && (
              <p style={{ marginTop: '1.2rem' }}>
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
            <h3 className="desc-head">Posting</h3>
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

      {newOpen && (
        <div className="dialog-back side" onClick={() => setNewOpen(false)}>
          <aside className="drawer" role="dialog" aria-label="New search" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <h2>New search</h2>
              <button className="btn quiet small" aria-label="Close" onClick={() => setNewOpen(false)}>
                <svg className="ic" viewBox="0 0 24 24" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            {!apifyOk && (
              <p className="notice">
                Searching needs an Apify token. Add <code>APIFY_TOKEN</code> to the environment and redeploy.
              </p>
            )}
            <form onSubmit={runSearch}>
              <label className="field" htmlFor="kw">
                Roles or skills
              </label>
              <TagInput id="kw" values={kw} onChange={setKw} placeholder="machine learning engineer" suggestions={titleIdeas} />
              <label className="field" htmlFor="loc">
                Places
              </label>
              <TagInput id="loc" values={loc} onChange={setLoc} placeholder="Bangalore, India" />
              {kw.length * Math.max(1, loc.length) > 1 && (
                <p className="hint">{kw.length * Math.max(1, loc.length)} searches per source (every role in every place).</p>
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
              <label className="field">Experience level</label>
              <div className="row" role="group" aria-label="LinkedIn experience level">
                {LINKEDIN_LEVELS.map((l) => (
                  <button key={l.code} type="button" className="chip" aria-pressed={levels.has(l.code)} onClick={() => setLevels((p) => toggle(p, l.code))}>
                    {l.label}
                  </button>
                ))}
              </div>
              <p className="hint" style={{ margin: '0.4rem 0 0' }}>
                LinkedIn only. It narrows the search before you are billed. None selected means any level.
              </p>
              <label className="check" style={{ marginTop: '1rem' }}>
                <input type="checkbox" checked={remote} onChange={(e) => setRemote(e.target.checked)} /> Remote only
              </label>
              {sources.length > 0 && (
                <>
                  <label className="field">Sources</label>
                  <div className="row" role="group" aria-label="Sources to search">
                    {sources
                      .filter((s) => s.enabled)
                      .map((s) => (
                        <button key={s.id} type="button" className="chip" aria-pressed={pickedSources.has(s.id)} onClick={() => setPickedSources((p) => toggle(p, s.id))}>
                          {s.label}
                        </button>
                      ))}
                  </div>
                </>
              )}
              {searchError && (
                <p className="err" role="alert">
                  {searchError}
                </p>
              )}
              <p style={{ marginTop: '1.4rem' }}>
                <button className="btn primary block" disabled={starting || running || !pickedSources.size}>
                  {starting ? 'Starting…' : running ? 'Searching…' : 'Run search'}
                </button>
              </p>
              <p className="hint">Each search is billed by Apify per listing returned. A short posted window keeps it cheap.</p>
            </form>
          </aside>
        </div>
      )}
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
