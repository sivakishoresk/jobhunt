import { env } from './env';

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
     dedupe_key text NOT NULL UNIQUE,
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
  `CREATE INDEX IF NOT EXISTS jobs_state_idx ON jobs(state)`,
  `CREATE INDEX IF NOT EXISTS jobs_first_seen_idx ON jobs(first_seen DESC)`,
  `CREATE TABLE IF NOT EXISTS search_jobs (
     search_id text NOT NULL,
     job_id text NOT NULL,
     PRIMARY KEY (search_id, job_id)
   )`,
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

const g = globalThis as unknown as { __jhDb?: Promise<Db> };

export function db(): Promise<Db> {
  if (!g.__jhDb) {
    g.__jhDb = (async () => {
      const d = await open();
      for (const stmt of SCHEMA) await d.query(stmt);
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
