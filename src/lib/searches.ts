import { q, j, kvGet, kvSet, type Row } from './db';
import { newId, errMessage, truncate } from './util';
import { getSources, renderInput, runQueries, MAX_RUNS, MAX_TERMS, asList, type SearchQuery } from './sources';
import { startRun, getRun, getItems, TERMINAL_FAIL, ApifyError } from './apify';
import { normalizeItem, matchesKeywords, type NormJob } from './normalize';
import { iso, listJobs, upsertJobs } from './jobs';

const RUN_TIMEOUT_MIN = 15;

export interface RunView {
  id: string;
  source: string;
  actor: string;
  keywords: string;
  location: string;
  status: 'running' | 'ingesting' | 'done' | 'failed';
  error: string | null;
  found: number;
  added: number;
  started_at: string | null;
}

export interface SearchView {
  id: string;
  query: SearchQuery;
  status: 'running' | 'done' | 'partial' | 'failed';
  created_at: string | null;
  runs: RunView[];
  found: number;
  added: number;
  /** Distinct jobs this search returned, new or already known. */
  jobs: number;
}

function mapRun(r: Row): RunView {
  return {
    id: r.id,
    source: r.source,
    actor: r.actor,
    keywords: r.kw ?? '',
    location: r.loc ?? '',
    status: r.status,
    error: r.error ?? null,
    found: r.found ?? 0,
    added: r.added ?? 0,
    started_at: iso(r.started_at),
  };
}

export async function startSearch(query: SearchQuery): Promise<SearchView> {
  const sources = (await getSources()).filter((s) => s.enabled && (!query.sources?.length || query.sources.includes(s.id)));
  if (!sources.length) throw new Error('No sources are enabled. Turn one on in Settings → Sources.');
  if (!asList(query.keywords).length) throw new Error('Enter a role or skills to search for.');
  if (asList(query.keywords).length > MAX_TERMS || asList(query.location).length > MAX_TERMS)
    throw new Error(`Use at most ${MAX_TERMS} roles and ${MAX_TERMS} places per search.`);
  const combos = runQueries(query);
  if (combos.length * sources.length > MAX_RUNS)
    throw new Error(`That would start ${combos.length * sources.length} paid runs (roles × places × sources). The limit is ${MAX_RUNS}; trim the lists.`);
  const searchId = newId('s');
  await q('INSERT INTO searches (id, query) VALUES ($1, $2::jsonb)', [searchId, j(query)]);

  await Promise.all(
    sources.flatMap((s) =>
      combos.map(async (c) => {
        const runId = newId('r');
        try {
          const input = renderInput(s.input, c, s.maxResults);
          const run = await startRun(s.actor, input);
          await q(
            `INSERT INTO search_runs (id, search_id, source, actor, apify_run_id, dataset_id, status, kw, loc)
             VALUES ($1,$2,$3,$4,$5,$6,'running',$7,$8)`,
            [runId, searchId, s.id, s.actor, run.id, run.datasetId, c.keywords, c.location],
          );
        } catch (e) {
          await q(
            `INSERT INTO search_runs (id, search_id, source, actor, status, error, finished_at, kw, loc)
             VALUES ($1,$2,$3,$4,'failed',$5, now(), $6, $7)`,
            [runId, searchId, s.id, s.actor, truncate(errMessage(e), 600), c.keywords, c.location],
          );
        }
      }),
    ),
  );
  return advanceSearch(searchId);
}

async function ingestRun(run: Row, query: SearchQuery, localFilter: boolean, searchId: string): Promise<void> {
  const claimed = await q(`UPDATE search_runs SET status = 'ingesting' WHERE id = $1 AND status = 'running' RETURNING id`, [run.id]);
  if (!claimed.length) return; // another request is already ingesting it
  try {
    const items = await getItems(run.dataset_id, 500);
    const jobs: NormJob[] = [];
    for (const it of items) {
      const n = normalizeItem(run.source, it);
      if (n) jobs.push(n);
    }
    const kept = localFilter ? jobs.filter((x) => matchesKeywords(x, run.kw ?? asList(query.keywords).join(' '))) : jobs;
    const res = await upsertJobs(searchId, kept, run.id);
    await q(`UPDATE search_runs SET status = 'done', found = $2, added = $3, finished_at = now() WHERE id = $1`, [
      run.id,
      kept.length,
      res.added,
    ]);
  } catch (e) {
    await q(`UPDATE search_runs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`, [
      run.id,
      truncate(errMessage(e), 600),
    ]);
  }
}

/** Checks Apify for progress, ingests finished runs, and returns the current state. Safe to call repeatedly. */
export async function advanceSearch(searchId: string): Promise<SearchView> {
  const s = await q('SELECT * FROM searches WHERE id = $1', [searchId]);
  if (!s.length) throw new Error('Search not found.');
  const query = s[0].query as SearchQuery;
  const sources = await getSources();
  let runs = await q('SELECT * FROM search_runs WHERE search_id = $1 ORDER BY started_at', [searchId]);

  await Promise.all(
    runs
      .filter((r) => r.status === 'running' && r.apify_run_id)
      .map(async (r) => {
        try {
          const info = await getRun(r.apify_run_id);
          if (info.status === 'SUCCEEDED') {
            const cfg = sources.find((x) => x.id === r.source);
            await ingestRun(r, query, !!cfg?.localKeywordFilter, searchId);
          } else if (TERMINAL_FAIL.has(info.status)) {
            await q(`UPDATE search_runs SET status='failed', error=$2, finished_at=now() WHERE id=$1 AND status='running'`, [
              r.id,
              `Apify run ${info.status.toLowerCase()}${info.statusMessage ? `: ${info.statusMessage}` : ''}`,
            ]);
          } else if (Date.now() - new Date(r.started_at).getTime() > RUN_TIMEOUT_MIN * 60_000) {
            await q(`UPDATE search_runs SET status='failed', error=$2, finished_at=now() WHERE id=$1 AND status='running'`, [
              r.id,
              `Still running after ${RUN_TIMEOUT_MIN} minutes; gave up waiting.`,
            ]);
          }
        } catch (e) {
          // transient Apify/network errors: leave the run as running, except hard failures
          if (e instanceof ApifyError && (e.status === 401 || e.status === 404)) {
            await q(`UPDATE search_runs SET status='failed', error=$2, finished_at=now() WHERE id=$1 AND status='running'`, [
              r.id,
              truncate(e.message, 600),
            ]);
          }
        }
      }),
  );

  runs = await q('SELECT * FROM search_runs WHERE search_id = $1 ORDER BY started_at', [searchId]);
  const pending = runs.some((r) => r.status === 'running' || r.status === 'ingesting');
  let status: SearchView['status'] = 'running';
  if (!pending) {
    const okCount = runs.filter((r) => r.status === 'done').length;
    status = okCount === runs.length ? 'done' : okCount === 0 ? 'failed' : 'partial';
    await q(`UPDATE searches SET status = $2, finished_at = COALESCE(finished_at, now()) WHERE id = $1`, [searchId, status]);
  }
  const views = runs.map(mapRun);
  const linked = await q('SELECT count(*)::int AS n FROM search_jobs WHERE search_id = $1', [searchId]);
  return {
    id: searchId,
    query,
    status,
    created_at: iso(s[0].created_at),
    runs: views,
    found: views.reduce((a, r) => a + r.found, 0),
    added: views.reduce((a, r) => a + r.added, 0),
    jobs: linked[0]?.n ?? 0,
  };
}

export async function listSearches(limit = 30): Promise<SearchView[]> {
  const searches = await q('SELECT * FROM searches ORDER BY created_at DESC LIMIT $1', [limit]);
  if (!searches.length) return [];
  const ids = searches.map((x) => x.id);
  const runRows = await q('SELECT * FROM search_runs WHERE search_id = ANY($1::text[]) ORDER BY started_at', [ids]);
  const counts = await q('SELECT search_id, count(*)::int AS n FROM search_jobs WHERE search_id = ANY($1::text[]) GROUP BY search_id', [ids]);
  const nJobs = new Map(counts.map((c) => [c.search_id as string, c.n as number]));
  return searches.map((r) => {
    const runs = runRows.filter((x) => x.search_id === r.id).map(mapRun);
    return {
      id: r.id,
      query: r.query,
      status: r.status,
      created_at: iso(r.created_at),
      runs,
      found: runs.reduce((a, x) => a + x.found, 0),
      added: runs.reduce((a, x) => a + x.added, 0),
      jobs: nJobs.get(r.id) ?? 0,
    };
  });
}

export interface SearchScope {
  ids: string[];
  /** Roles and places this search covered, when more than one of either (otherwise nothing to filter by). */
  roles: string[];
  places: string[];
  /** [job id, role index, place index] for every run that returned the job. */
  rows: [string, number, number][];
}

/**
 * Searches run before run-level tracking existed have no record of which run found which job.
 * Apify keeps each run's dataset for a while, so read it again (free) and rebuild the link.
 * Each run is tried once; a dataset that has expired is simply skipped.
 */
async function reattributeRuns(searchId: string): Promise<void> {
  const runs = await q(
    `SELECT r.* FROM search_runs r
     WHERE r.search_id = $1 AND r.status = 'done' AND r.dataset_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM run_jobs rj WHERE rj.run_id = r.id)`,
    [searchId],
  );
  if (!runs.length) return;
  const sources = await getSources();
  await Promise.all(
    runs.slice(0, MAX_RUNS).map(async (run) => {
      const flag = `reattr:${run.id}`;
      if (await kvGet(flag)) return;
      try {
        const items = await getItems(run.dataset_id, 500);
        const keys = new Set<string>();
        const local = !!sources.find((x) => x.id === run.source)?.localKeywordFilter;
        for (const it of items) {
          const n = normalizeItem(run.source, it);
          if (!n) continue;
          if (local && run.kw && !matchesKeywords(n, run.kw)) continue;
          keys.add(n.dedupe_key);
        }
        if (keys.size) {
          await q(
            `INSERT INTO run_jobs (run_id, job_id)
             SELECT $1, j.id FROM jobs j
             WHERE j.dedupe_key = ANY($2::text[]) AND j.id IN (SELECT job_id FROM search_jobs WHERE search_id = $3)
             ON CONFLICT DO NOTHING`,
            [run.id, [...keys], searchId],
          );
        }
        await kvSet(flag, true);
      } catch (e) {
        // A dataset Apify no longer has will never come back; anything else may be temporary.
        if (e instanceof ApifyError && e.status === 404) await kvSet(flag, true);
      }
    }),
  );
}

/** Ids of every job a search returned, and which role/place run found each one. */
export async function scopeForSearch(searchId: string): Promise<SearchScope> {
  await reattributeRuns(searchId).catch(() => {});
  const ids = (await q('SELECT job_id FROM search_jobs WHERE search_id = $1', [searchId])).map((r) => r.job_id as string);
  const s = await q('SELECT query FROM searches WHERE id = $1', [searchId]);
  const query = (s[0]?.query ?? {}) as SearchQuery;
  const queryRoles = asList(query.keywords);
  const queryPlaces = asList(query.location);
  const attr = await q(
    `SELECT rj.job_id, r.kw, r.loc FROM run_jobs rj JOIN search_runs r ON r.id = rj.run_id WHERE r.search_id = $1`,
    [searchId],
  );
  const roles: string[] = [...queryRoles];
  const places: string[] = [...queryPlaces];
  const at = (list: string[], v: string) => {
    const i = list.findIndex((x) => x.toLowerCase() === v.toLowerCase());
    if (i >= 0) return i;
    list.push(v);
    return list.length - 1;
  };
  const rows: [string, number, number][] = [];
  const seen = new Set<string>();
  for (const a of attr) {
    const role = ((a.kw as string | null) ?? (queryRoles.length === 1 ? queryRoles[0] : '')).trim();
    const place = ((a.loc as string | null) ?? (queryPlaces.length === 1 ? queryPlaces[0] : '')).trim();
    const key = `${a.job_id}|${role.toLowerCase()}|${place.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push([a.job_id as string, at(roles, role), at(places, place)]);
  }
  // Nothing to filter by unless the search covered several roles or several places.
  if (!rows.length || (roles.length < 2 && places.length < 2)) return { ids, roles: [], places: [], rows: [] };
  return { ids, roles, places, rows };
}

export async function jobsForSearch(searchId: string, limit = 50) {
  return listJobs({ searchId, sort: 'newest', limit, state: 'active' });
}
