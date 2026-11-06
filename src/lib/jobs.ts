import { createHash } from 'node:crypto';
import { q, j, type Row } from './db';
import { newId, clamp } from './util';
import type { NormJob } from './normalize';
import { extractYears } from './experience';

export const JOB_STATES = ['new', 'saved', 'applied', 'dismissed'] as const;
export type JobState = (typeof JOB_STATES)[number];

export const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

export interface JobSummary {
  id: string;
  source: string;
  title: string;
  company: string;
  location: string;
  remote: boolean;
  url: string | null;
  posted_at: string | null;
  first_seen: string | null;
  salary: string | null;
  employment_type: string | null;
  seniority: string | null;
  tags: string[];
  state: JobState;
  score: number | null;
  snippet: string;
  desc_len: number;
  min_years: number | null;
  max_years: number | null;
}

function mapSummary(r: Row): JobSummary {
  return {
    id: r.id,
    source: r.source,
    title: r.title,
    company: r.company,
    location: r.location,
    remote: !!r.remote,
    url: r.url ?? null,
    posted_at: iso(r.posted_at),
    first_seen: iso(r.first_seen),
    salary: r.salary ?? null,
    employment_type: r.employment_type ?? null,
    seniority: r.seniority ?? null,
    tags: Array.isArray(r.tags) ? r.tags : [],
    state: r.state,
    score: r.score ?? null,
    snippet: r.snippet ?? '',
    desc_len: Number(r.desc_len ?? 0),
    min_years: r.min_years ?? null,
    max_years: r.max_years ?? null,
  };
}

const SUMMARY_COLS = `id, source, title, company, location, remote, url, posted_at, first_seen, salary,
  employment_type, seniority, tags, state, score, left(description, 600) AS snippet, length(description) AS desc_len, min_years, max_years`;

export interface JobFilters {
  state?: string;
  minScore?: number;
  source?: string;
  query?: string;
  postedWithinDays?: number;
  remote?: boolean;
  searchId?: string;
  /** With searchId: only jobs found by the run for this role / this place (case-insensitive, exact). */
  runRole?: string;
  runPlace?: string;
  /** Only jobs first seen at or after this time (used for "new from this search"). */
  firstSeenAfter?: string;
  /** Years of experience the posting asks for, inclusive range. */
  yearsMin?: number;
  yearsMax?: number;
  /** With a years range: also keep postings that don't state a number. Defaults to true. */
  yearsUnstated?: boolean;
  unscored?: boolean;
  sort?: 'newest' | 'score' | 'company';
  limit?: number;
  offset?: number;
}

export async function listJobs(uid: string, f: JobFilters = {}): Promise<{ jobs: JobSummary[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  add('user_id = ?', uid);
  if (f.state && f.state !== 'all') {
    if (f.state === 'active') where.push(`state <> 'dismissed'`);
    else add('state = ?', f.state);
  }
  if (f.minScore != null) add('score >= ?', f.minScore);
  if (f.source) add('source = ?', f.source);
  if (f.remote) where.push('remote = true');
  if (f.unscored) where.push('score IS NULL');
  if (f.postedWithinDays) add(`COALESCE(posted_at, first_seen) > now() - (? || ' days')::interval`, String(f.postedWithinDays));
  if (f.firstSeenAfter) add('first_seen >= ?::timestamptz', f.firstSeenAfter);
  if (f.yearsMin != null || f.yearsMax != null) {
    const lo = f.yearsMin ?? 0;
    const hi = f.yearsMax ?? 99;
    params.push(lo, hi);
    const range = `(min_years >= $${params.length - 1} AND min_years <= $${params.length})`;
    where.push(f.yearsUnstated === false ? range : `(${range} OR min_years IS NULL)`);
  }
  if (f.searchId) add('id IN (SELECT job_id FROM search_jobs WHERE search_id = ?)', f.searchId);
  if (f.searchId && (f.runRole || f.runPlace)) {
    const parts = ['r.search_id = ?'];
    const vals: unknown[] = [f.searchId];
    if (f.runRole) { parts.push('lower(r.kw) = lower(?)'); vals.push(f.runRole); }
    if (f.runPlace) { parts.push("lower(COALESCE(r.loc, '')) = lower(?)"); vals.push(f.runPlace); }
    const marks = parts.map((p) => {
      if (!p.includes('?')) return p;
      params.push(vals.shift());
      return p.replace('?', `$${params.length}`);
    });
    where.push(`id IN (SELECT rj.job_id FROM run_jobs rj JOIN search_runs r ON r.id = rj.run_id WHERE ${marks.join(' AND ')})`);
  }
  if (f.query?.trim()) {
    const like = `%${f.query.trim().replace(/[%_\\]/g, '\\$&')}%`;
    params.push(like);
    const n = `$${params.length}`;
    where.push(`(title ILIKE ${n} OR company ILIKE ${n} OR location ILIKE ${n} OR description ILIKE ${n})`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order =
    f.sort === 'score'
      ? 'score DESC NULLS LAST, COALESCE(posted_at, first_seen) DESC'
      : f.sort === 'company'
        ? 'lower(company), COALESCE(posted_at, first_seen) DESC'
        : 'COALESCE(posted_at, first_seen) DESC';
  const limit = clamp(f.limit ?? 50, 1, 2000);
  const offset = Math.max(0, f.offset ?? 0);
  const rows = await q(`SELECT ${SUMMARY_COLS} FROM jobs ${w} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, params);
  const cnt = await q(`SELECT count(*)::int AS n FROM jobs ${w}`, params);
  return { jobs: rows.map(mapSummary), total: cnt[0]?.n ?? 0 };
}

export interface JobFull extends JobSummary {
  description: string;
  apply_url: string | null;
  score_reasons: string[];
  score_flags: string[];
  notes: string;
  applications: { id: string; status: string }[];
}

export async function getJob(uid: string, id: string): Promise<JobFull | null> {
  const rows = await q(`SELECT ${SUMMARY_COLS}, description, apply_url, score_reasons, score_flags, notes FROM jobs WHERE id = $1 AND user_id = $2`, [id, uid]);
  if (!rows.length) return null;
  const r = rows[0];
  const apps = await q('SELECT id, status FROM applications WHERE job_id = $1 AND user_id = $2 ORDER BY created_at DESC', [id, uid]);
  return {
    ...mapSummary(r),
    description: r.description ?? '',
    apply_url: r.apply_url ?? null,
    score_reasons: Array.isArray(r.score_reasons) ? r.score_reasons : [],
    score_flags: Array.isArray(r.score_flags) ? r.score_flags : [],
    notes: r.notes ?? '',
    applications: apps.map((a) => ({ id: a.id, status: a.status })),
  };
}

export async function setJobState(uid: string, ids: string[], state: JobState): Promise<number> {
  if (!ids.length) return 0;
  const rows = await q(
    `UPDATE jobs SET state = $2 WHERE user_id = $3 AND id IN (SELECT jsonb_array_elements_text($1::jsonb)) RETURNING id`,
    [j(ids), state, uid],
  );
  return rows.length;
}

export async function setJobNotes(uid: string, id: string, notes: string): Promise<boolean> {
  const rows = await q('UPDATE jobs SET notes = $2 WHERE id = $1 AND user_id = $3 RETURNING id', [id, notes.slice(0, 5000), uid]);
  return rows.length > 0;
}

export interface ScoreInput {
  job_id: string;
  score: number;
  reasons?: string[];
  flags?: string[];
}

export async function saveScores(uid: string, scores: ScoreInput[]): Promise<{ saved: number; unknown: string[] }> {
  const clean = scores.map((s) => ({
    job_id: s.job_id,
    score: clamp(Math.round(s.score), 0, 100),
    reasons: (s.reasons ?? []).slice(0, 6).map((x) => x.slice(0, 300)),
    flags: (s.flags ?? []).slice(0, 6).map((x) => x.slice(0, 300)),
  }));
  const rows = await q(
    `UPDATE jobs SET score = x.score, score_reasons = x.reasons, score_flags = x.flags
     FROM jsonb_to_recordset($1::jsonb) AS x(job_id text, score int, reasons jsonb, flags jsonb)
     WHERE jobs.id = x.job_id AND jobs.user_id = $2 RETURNING jobs.id`,
    [j(clean), uid],
  );
  const ok = new Set(rows.map((r) => r.id));
  return { saved: ok.size, unknown: clean.map((c) => c.job_id).filter((id) => !ok.has(id)) };
}

const UPSERT_SQL = `
WITH incoming AS (
  SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
    id text, dedupe_key text, source text, external_id text, title text, company text, location text,
    remote boolean, url text, apply_url text, description text, posted_at text, salary text,
    employment_type text, seniority text, tags jsonb, min_years int, max_years int)
)
INSERT INTO jobs (user_id, id, dedupe_key, source, external_id, title, company, location, remote, url, apply_url,
                  description, posted_at, salary, employment_type, seniority, tags, min_years, max_years)
SELECT $2::text, id, dedupe_key, source, external_id, title, company, location, remote, url, apply_url,
       description, NULLIF(posted_at, '')::timestamptz, salary, employment_type, seniority,
       COALESCE(tags, '[]'::jsonb), min_years, max_years
FROM incoming
ON CONFLICT (user_id, dedupe_key) DO UPDATE SET
  last_seen = now(),
  min_years = CASE WHEN length(EXCLUDED.description) > length(jobs.description) THEN EXCLUDED.min_years ELSE jobs.min_years END,
  max_years = CASE WHEN length(EXCLUDED.description) > length(jobs.description) THEN EXCLUDED.max_years ELSE jobs.max_years END,
  description = CASE WHEN length(EXCLUDED.description) > length(jobs.description) THEN EXCLUDED.description ELSE jobs.description END,
  posted_at = COALESCE(jobs.posted_at, EXCLUDED.posted_at),
  salary = COALESCE(jobs.salary, EXCLUDED.salary),
  apply_url = COALESCE(jobs.apply_url, EXCLUDED.apply_url),
  url = COALESCE(jobs.url, EXCLUDED.url)
RETURNING id, (xmax = 0) AS inserted`;

export async function upsertJobs(uid: string, searchId: string | null, jobs: NormJob[], runId: string | null = null): Promise<{ added: number; seen: number; ids: string[] }> {
  const byKey = new Map<string, NormJob>();
  for (const job of jobs) if (!byKey.has(job.dedupe_key)) byKey.set(job.dedupe_key, job);
  const unique = [...byKey.values()];
  let added = 0;
  const ids: string[] = [];
  for (let i = 0; i < unique.length; i += 150) {
    const chunk = unique.slice(i, i + 150).map((job) => ({ id: newId('j'), ...job }));
    const rows = await q(UPSERT_SQL, [j(chunk), uid]);
    for (const r of rows) {
      ids.push(r.id);
      if (r.inserted) added++;
    }
  }
  if (searchId && ids.length) {
    await q(
      `INSERT INTO search_jobs (search_id, job_id)
       SELECT $1, jsonb_array_elements_text($2::jsonb) ON CONFLICT DO NOTHING`,
      [searchId, j(ids)],
    );
  }
  if (runId && ids.length) {
    await q(
      `INSERT INTO run_jobs (run_id, job_id)
       SELECT $1, jsonb_array_elements_text($2::jsonb) ON CONFLICT DO NOTHING`,
      [runId, j(ids)],
    );
  }
  return { added, seen: unique.length, ids };
}

export async function addManualJob(uid: string, input: {
  title: string;
  company: string;
  description: string;
  url?: string;
  location?: string;
  remote?: boolean;
}): Promise<{ id: string; duplicate: boolean }> {
  const key = createHash('sha1')
    .update([input.url ?? '', input.title, input.company, input.description.slice(0, 300)].join('|').toLowerCase())
    .digest('hex')
    .slice(0, 16);
  const yrs = extractYears(input.description);
  const job: NormJob = {
    dedupe_key: `manual:${key}`,
    source: 'manual',
    external_id: null,
    title: input.title.slice(0, 300),
    company: input.company.slice(0, 200),
    location: (input.location ?? '').slice(0, 200),
    remote: !!input.remote,
    url: input.url ?? null,
    apply_url: null,
    description: input.description,
    posted_at: new Date().toISOString(),
    salary: null,
    employment_type: null,
    seniority: null,
    tags: [],
    min_years: yrs.min,
    max_years: yrs.max,
  };
  const res = await upsertJobs(uid, null, [job]);
  return { id: res.ids[0], duplicate: res.added === 0 };
}
