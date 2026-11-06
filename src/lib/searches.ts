import { q, j, kvGet, kvSet, type Row } from './db';
import { newId, errMessage, truncate, HttpError } from './util';
import { getSources, renderInput, runQueries, MAX_RUNS, MAX_TERMS, asList, type SearchQuery } from './sources';
import { startRun, getRun, getItems, TERMINAL_FAIL, ApifyError } from './apify';
import { normalizeItem, matchesKeywords, type NormJob } from './normalize';
import { iso, listJobs, upsertJobs } from './jobs';
import { apifyTokenFor, NEEDS_TOKEN } from './users';

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

export async function startSearch(uid: string, query: SearchQuery): Promise<SearchView> {
  const tok = await apifyTokenFor(uid);
  if (!tok) throw new HttpError(400, NEEDS_TOKEN);
  const token = tok.token;
  const sources = (await getSources(uid)).filter((s) => s.enabled && (!query.sources?.length || query.sources.includes(s.id)));
  if (!sources.length) throw new Error('No sources are enabled. Turn one on in Settings → Sources.');
  if (!asList(query.keywords).length) throw new Error('Enter a role or skills to search for.');
  if (asList(query.keywords).length > MAX_TERMS || asList(query.location).length > MAX_TERMS)
    throw new Error(`Use at most ${MAX_TERMS} roles and ${MAX_TERMS} places per search.`);
  const combos = runQueries(query);
  if (combos.length * sources.length > MAX_RUNS)
    throw new Error(`That would start ${combos.length * sources.length} paid runs (roles × places × sources). The limit is ${MAX_RUNS}; trim the lists.`);
  const searchId = newId('s');
  await q('INSERT INTO searches (id, user_id, query) VALUES ($1, $3, $2::jsonb)', [searchId, j(query), uid]);

  await Promise.all(
    sources.flatMap((s) =>
      combos.map(async (c) => {
        const runId = newId('r');
        try {
          const input = renderInput(s.input, c, s.maxResults);
          const run = await startRun(token, s.actor, input);
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
  return advanceSearch(uid, searchId);
}

async function ingestRun(uid: string, token: string, run: Row, query: SearchQuery, localFilter: boolean, searchId: string): Promise<void> {
  const claimed = await q(`UPDATE search_runs SET status = 'ingesting' WHERE id = $1 AND status = 'running' RETURNING id`, [run.id]);
  if (!claimed.length) return; // another request is already ingesting it
  try {
    const items = await getItems(token, run.dataset_id, 500);
    const jobs: NormJob[] = [];
    for (const it of items) {
      const n = normalizeItem(run.source, it);
      if (n) jobs.push(n);
    }
    const kept = localFilter ? jobs.filter((x) => matchesKeywords(x, run.kw ?? asList(query.keywords).join(' '))) : jobs;
    const res = await upsertJobs(uid, searchId, kept, run.id);
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
export async function advanceSearch(uid: string, searchId: string): Promise<SearchView> {
  const s = await q('SELECT * FROM searches WHERE id = $1 AND user_id = $2', [searchId, uid]);
  if (!s.length) throw new HttpError(404, 'Search not found.');
  const query = s[0].query as SearchQuery;
  const sources = await getSources(uid);
  const token = (await apifyTokenFor(uid))?.token ?? '';
  let runs = await q('SELECT * FROM search_runs WHERE search_id = $1 ORDER BY started_at', [searchId]);

  await Promise.all(
    runs
      .filter((r) => r.status === 'running' && r.apify_run_id)
      .map(async (r) => {
        try {
          const info = await getRun(token, r.apify_run_id);
          if (info.status === 'SUCCEEDED') {
            const cfg = sources.find((x) => x.id === r.source);
            await ingestRun(uid, token, r, query, !!cfg?.localKeywordFilter, searchId);
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

export async function listSearches(uid: string, limit = 30): Promise<SearchView[]> {
  const searches = await q('SELECT * FROM searches WHERE user_id = $2 ORDER BY created_at DESC LIMIT $1', [limit, uid]);
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
async function reattributeRuns(uid: string, searchId: string): Promise<void> {
  const runs = await q(
    `SELECT r.* FROM search_runs r
     WHERE r.search_id = $1 AND r.status = 'done' AND r.dataset_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM run_jobs rj WHERE rj.run_id = r.id)`,
    [searchId],
  );
  if (!runs.length) return;
  const sources = await getSources(uid);
  const token = (await apifyTokenFor(uid))?.token;
  if (!token) return;
  await Promise.all(
    runs.slice(0, MAX_RUNS).map(async (run) => {
      const flag = `reattr:${run.id}`;
      if (await kvGet(flag)) return;
      try {
        const items = await getItems(token, run.dataset_id, 500);
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
             WHERE j.user_id = $4 AND j.dedupe_key = ANY($2::text[]) AND j.id IN (SELECT job_id FROM search_jobs WHERE search_id = $3)
             ON CONFLICT DO NOTHING`,
            [run.id, [...keys], searchId, uid],
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
export async function scopeForSearch(uid: string, searchId: string): Promise<SearchScope> {
  const s = await q('SELECT query FROM searches WHERE id = $1 AND user_id = $2', [searchId, uid]);
  if (!s.length) throw new HttpError(404, 'Search not found.');
  await reattributeRuns(uid, searchId).catch(() => {});
  const ids = (await q('SELECT job_id FROM search_jobs WHERE search_id = $1', [searchId])).map((r) => r.job_id as string);
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

export async function jobsForSearch(uid: string, searchId: string, limit = 50) {
  return listJobs(uid, { searchId, sort: 'newest', limit, state: 'active' });
}

/** For each search, how many of its listings have no fit score yet (active jobs only). */
export async function unscoredCounts(uid: string, ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const rows = await q(
    `SELECT sj.search_id, count(*)::int AS n FROM search_jobs sj JOIN jobs jb ON jb.id = sj.job_id
     WHERE sj.search_id = ANY($1::text[]) AND jb.user_id = $2 AND jb.score IS NULL AND jb.state <> 'dismissed' GROUP BY sj.search_id`,
    [ids, uid],
  );
  return new Map(rows.map((r) => [r.search_id as string, r.n as number]));
}

export type SearchMatch = { search: SearchView; role: string | null };

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9+#.]+/).filter((w) => w.length >= 2);

/**
 * Finds searches by what they were for, e.g. "AI Research Engineer". A search matches when every word appears in
 * one of its roles (then `role` says which) or in its role text as a whole. Newest first; searches with listings first.
 */
export async function findSearches(uid: string, text: string, limit = 60): Promise<SearchMatch[]> {
  const want = words(text);
  if (!want.length) return [];
  const all = await listSearches(uid, limit);
  const out: SearchMatch[] = [];
  for (const sx of all) {
    const roles = asList(sx.query.keywords);
    const hit = roles.find((r) => want.every((w) => words(r).includes(w)));
    if (hit) {
      out.push({ search: sx, role: roles.length > 1 ? hit : null });
      continue;
    }
    const joined = words(roles.join(' '));
    if (want.every((w) => joined.includes(w))) out.push({ search: sx, role: null });
  }
  return [...out.filter((m) => m.search.jobs > 0), ...out.filter((m) => m.search.jobs === 0)];
}
