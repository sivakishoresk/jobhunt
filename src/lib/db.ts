import { env } from './env';
import { extractYears } from './experience';
import { hashPassword } from './passwords';
import { newId } from './util';

export type Row = Record<string, any>;
export interface Db {
  query(text: string, params?: unknown[]): Promise<Row[]>;
}

const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS kv (
     key text PRIMARY KEY,
     value jsonb NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS searches (
     id text PRIMARY KEY,
     query jsonb NOT NULL,
     status text NOT NULL DEFAULT 'running',
     created_at timestamptz NOT NULL DEFAULT now(),
     finished_at timestamptz
   )`,
  `CREATE TABLE IF NOT EXISTS search_runs (
     id text PRIMARY KEY,
     search_id text NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
     source text NOT NULL,
     actor text NOT NULL,
     apify_run_id text,
     dataset_id text,
     status text NOT NULL DEFAULT 'running',
     error text,
     found int NOT NULL DEFAULT 0,
     added int NOT NULL DEFAULT 0,
     started_at timestamptz NOT NULL DEFAULT now(),
     finished_at timestamptz
   )`,
  `ALTER TABLE search_runs ADD COLUMN IF NOT EXISTS kw text`,
  `ALTER TABLE search_runs ADD COLUMN IF NOT EXISTS loc text`,
  `CREATE INDEX IF NOT EXISTS search_runs_search_idx ON search_runs(search_id)`,
  `CREATE TABLE IF NOT EXISTS jobs (
     id text PRIMARY KEY,
     dedupe_key text NOT NULL,
     source text NOT NULL,
     external_id text,
     title text NOT NULL,
     company text NOT NULL DEFAULT '',
     location text NOT NULL DEFAULT '',
     remote boolean NOT NULL DEFAULT false,
     url text,
     apply_url text,
     description text NOT NULL DEFAULT '',
     posted_at timestamptz,
     salary text,
     employment_type text,
     seniority text,
     tags jsonb NOT NULL DEFAULT '[]'::jsonb,
     state text NOT NULL DEFAULT 'new',
     score int,
     score_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
     score_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
     first_seen timestamptz NOT NULL DEFAULT now(),
     last_seen timestamptz NOT NULL DEFAULT now(),
     notes text NOT NULL DEFAULT ''
   )`,
  `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS min_years int`,
  `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS max_years int`,
  `CREATE INDEX IF NOT EXISTS jobs_state_idx ON jobs(state)`,
  `CREATE INDEX IF NOT EXISTS jobs_first_seen_idx ON jobs(first_seen DESC)`,
  `CREATE TABLE IF NOT EXISTS search_jobs (
     search_id text NOT NULL,
     job_id text NOT NULL,
     PRIMARY KEY (search_id, job_id)
   )`,
  `CREATE INDEX IF NOT EXISTS search_jobs_job_idx ON search_jobs(job_id)`,
  `CREATE TABLE IF NOT EXISTS run_jobs (
     run_id text NOT NULL,
     job_id text NOT NULL,
     PRIMARY KEY (run_id, job_id)
   )`,
  `CREATE INDEX IF NOT EXISTS run_jobs_job_idx ON run_jobs(job_id)`,
  `CREATE TABLE IF NOT EXISTS applications (
     id text PRIMARY KEY,
     job_id text REFERENCES jobs(id) ON DELETE SET NULL,
     status text NOT NULL DEFAULT 'draft',
     title text NOT NULL,
     company text NOT NULL,
     resume jsonb NOT NULL DEFAULT '{}'::jsonb,
     cover_letter text NOT NULL DEFAULT '',
     gaps jsonb NOT NULL DEFAULT '[]'::jsonb,
     checks jsonb NOT NULL DEFAULT '[]'::jsonb,
     notes text NOT NULL DEFAULT '',
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     sent_at timestamptz
   )`,
  `CREATE TABLE IF NOT EXISTS users (
     id text PRIMARY KEY,
     username text NOT NULL UNIQUE,
     password_hash text NOT NULL,
     is_owner boolean NOT NULL DEFAULT false,
     apify_token_enc text,
     created_at timestamptz NOT NULL DEFAULT now(),
     last_login_at timestamptz
   )`,
  `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS user_id text`,
  `ALTER TABLE searches ADD COLUMN IF NOT EXISTS user_id text`,
  `ALTER TABLE applications ADD COLUMN IF NOT EXISTS user_id text`,
  // Jobs used to be unique across the whole database; now they are unique per user.
  `ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_dedupe_key_key`,
  `CREATE TABLE IF NOT EXISTS used_tokens (
     jti text PRIMARY KEY,
     expires_at timestamptz NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
     id bigserial PRIMARY KEY,
     ip text NOT NULL,
     at timestamptz NOT NULL DEFAULT now()
   )`,
];

// Created after existing rows are assigned to the owner (see migrateToUsers).
const USER_INDEXES: string[] = [
  `CREATE UNIQUE INDEX IF NOT EXISTS jobs_user_dedupe_idx ON jobs(user_id, dedupe_key)`,
  `CREATE INDEX IF NOT EXISTS jobs_user_idx ON jobs(user_id, state)`,
  `CREATE INDEX IF NOT EXISTS searches_user_idx ON searches(user_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS applications_user_idx ON applications(user_id, updated_at DESC)`,
];

async function open(): Promise<Db> {
  const url = env('DATABASE_URL') || env('POSTGRES_URL') || env('POSTGRES_PRISMA_URL');
  if (url) {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(url);
    return { query: async (text, params = []) => (await sql.query(text, params as any[])) as Row[] };
  }
  if (env('VERCEL')) {
    throw new Error('DATABASE_URL is not set. Add a Postgres database (for example Neon) to the Vercel project.');
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = env('LOCAL_DB_DIR');
  if (dir) (await import('node:fs')).mkdirSync(dir, { recursive: true });
  const pg = dir ? new PGlite(dir) : new PGlite();
  await pg.waitReady;
  return { query: async (text, params = []) => (await pg.query(text, params as any[])).rows as Row[] };
}

/** One-time: read years of experience out of jobs saved before that column existed. */
async function backfillYears(d: Db): Promise<void> {
  if ((await d.query(`SELECT 1 FROM kv WHERE key = 'years_backfill_v1'`)).length) return;
  let after = '';
  for (;;) {
    const rows = await d.query(`SELECT id, description FROM jobs WHERE id > $1 ORDER BY id LIMIT 200`, [after]);
    if (!rows.length) break;
    after = rows[rows.length - 1].id;
    const found = rows
      .map((r) => ({ id: r.id as string, ...extractYears(r.description as string) }))
      .filter((r) => r.min != null)
      .map((r) => ({ id: r.id, min: r.min, max: r.max }));
    if (found.length) {
      await d.query(
        `UPDATE jobs SET min_years = x.min, max_years = x.max
         FROM jsonb_to_recordset($1::jsonb) AS x(id text, min int, max int)
         WHERE jobs.id = x.id AND jobs.min_years IS NULL`,
        [JSON.stringify(found)],
      );
    }
  }
  await d.query(`INSERT INTO kv (key, value) VALUES ('years_backfill_v1', 'true'::jsonb) ON CONFLICT (key) DO NOTHING`);
}

/**
 * Accounts arrived after the first release: everything saved before belongs to the owner,
 * who is created here on first start (OWNER_USERNAME / OWNER_PASSWORD, default sksiva / sksiva).
 */
async function migrateToUsers(d: Db): Promise<void> {
  let owner = (await d.query(`SELECT id FROM users WHERE is_owner ORDER BY created_at LIMIT 1`))[0]?.id as string | undefined;
  if (!owner) {
    const username = (env('OWNER_USERNAME') || 'sksiva').toLowerCase();
    const hash = await hashPassword(env('OWNER_PASSWORD') || 'sksiva');
    const made = await d.query(
      `INSERT INTO users (id, username, password_hash, is_owner) VALUES ($1, $2, $3, true) ON CONFLICT (username) DO NOTHING RETURNING id`,
      [newId('u'), username, hash],
    );
    owner = (made[0]?.id ?? (await d.query(`SELECT id FROM users WHERE is_owner LIMIT 1`))[0]?.id) as string | undefined;
    if (!owner) throw new Error('Could not create the owner account.');
  }
  for (const t of ['jobs', 'searches', 'applications']) await d.query(`UPDATE ${t} SET user_id = $1 WHERE user_id IS NULL`, [owner]);
  if (!(await d.query(`SELECT 1 FROM kv WHERE key = 'users_migrated_v1'`)).length) {
    for (const k of ['profile', 'sources']) {
      await d.query(
        `INSERT INTO kv (key, value) SELECT $2, value FROM kv WHERE key = $1 ON CONFLICT (key) DO NOTHING`,
        [k, `u:${owner}:${k}`],
      );
    }
    await d.query(`INSERT INTO kv (key, value) VALUES ('users_migrated_v1', 'true'::jsonb) ON CONFLICT (key) DO NOTHING`);
  }
  for (const stmt of USER_INDEXES) await d.query(stmt);
  for (const t of ['jobs', 'searches', 'applications']) {
    await d.query(`ALTER TABLE ${t} ALTER COLUMN user_id SET NOT NULL`).catch(() => {});
  }
}

const g = globalThis as unknown as { __jhDb?: Promise<Db> };

export function db(): Promise<Db> {
  if (!g.__jhDb) {
    g.__jhDb = (async () => {
      const d = await open();
      for (const stmt of SCHEMA) await d.query(stmt);
      await migrateToUsers(d);
      await backfillYears(d).catch(() => {}); // best effort; the app works without it
      return d;
    })().catch((e) => {
      g.__jhDb = undefined;
      throw e;
    });
  }
  return g.__jhDb;
}

export async function q(text: string, params: unknown[] = []): Promise<Row[]> {
  return (await db()).query(text, params);
}

/** JSON parameter for a ::jsonb placeholder. */
export const j = (v: unknown) => JSON.stringify(v ?? null);

export async function kvGet<T>(key: string): Promise<T | null> {
  const rows = await q('SELECT value FROM kv WHERE key = $1', [key]);
  return rows.length ? (rows[0].value as T) : null;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await q(
    `INSERT INTO kv (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, j(value)],
  );
}

/** Per-user key-value storage (profile, sources). */
export const ukey = (uid: string, key: string) => `u:${uid}:${key}`;
