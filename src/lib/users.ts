import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { q } from './db';
import { env, requireEnv } from './env';
import { hashPassword, verifyPassword, burnTime } from './passwords';
import { newId } from './util';

export interface User {
  id: string;
  username: string;
  isOwner: boolean;
  /** Changes whenever the password does, so old sessions and Claude connections stop working. */
  pv: string;
}

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 200;

const pvOf = (hash: string) => createHash('sha256').update(hash).digest('hex').slice(0, 12);

function map(r: Record<string, any>): User {
  return { id: r.id, username: r.username, isOwner: !!r.is_owner, pv: pvOf(r.password_hash) };
}

export const normalizeUsername = (s: string) => s.trim().toLowerCase();

export function checkNewCredentials(username: string, password: string): string | null {
  if (!USERNAME_RE.test(username)) return 'Username must be 3 to 30 characters: letters, numbers, dot, dash or underscore, starting with a letter or number.';
  if (password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
  if (password.length > MAX_PASSWORD) return 'Password is too long.';
  if (password.toLowerCase() === username) return 'Password cannot be the same as your username.';
  return null;
}

export async function getUserById(id: string): Promise<User | null> {
  const rows = await q('SELECT id, username, is_owner, password_hash FROM users WHERE id = $1', [id]);
  return rows.length ? map(rows[0]) : null;
}

export async function ownerId(): Promise<string | null> {
  const rows = await q('SELECT id FROM users WHERE is_owner ORDER BY created_at LIMIT 1');
  return rows[0]?.id ?? null;
}

export async function createUser(username: string, password: string): Promise<User> {
  const id = newId('u');
  const rows = await q(
    `INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING
     RETURNING id, username, is_owner, password_hash`,
    [id, username, await hashPassword(password)],
  );
  if (!rows.length) throw new Error('That username is taken.');
  return map(rows[0]);
}

/** Returns the user when the username and password match, otherwise null. */
export async function verifyLogin(username: string, password: string): Promise<User | null> {
  const rows = await q('SELECT id, username, is_owner, password_hash FROM users WHERE username = $1', [username]);
  if (!rows.length) {
    await burnTime(password);
    return null;
  }
  if (!(await verifyPassword(password, rows[0].password_hash))) return null;
  await q('UPDATE users SET last_login_at = now() WHERE id = $1', [rows[0].id]);
  return map(rows[0]);
}

export async function setPassword(uid: string, password: string): Promise<void> {
  await q('UPDATE users SET password_hash = $2 WHERE id = $1', [uid, await hashPassword(password)]);
}

export async function checkPassword(uid: string, password: string): Promise<boolean> {
  const rows = await q('SELECT password_hash FROM users WHERE id = $1', [uid]);
  return rows.length > 0 && verifyPassword(password, rows[0].password_hash);
}

// ---- owner tools ----

export interface UserRow {
  id: string;
  username: string;
  isOwner: boolean;
  createdAt: string | null;
  lastLoginAt: string | null;
  jobs: number;
  searches: number;
  applications: number;
}

export async function listUsers(): Promise<UserRow[]> {
  const rows = await q(
    `SELECT u.id, u.username, u.is_owner, u.created_at, u.last_login_at,
       (SELECT count(*)::int FROM jobs WHERE user_id = u.id) AS jobs,
       (SELECT count(*)::int FROM searches WHERE user_id = u.id) AS searches,
       (SELECT count(*)::int FROM applications WHERE user_id = u.id) AS applications
     FROM users u ORDER BY u.is_owner DESC, u.created_at`,
  );
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    isOwner: !!r.is_owner,
    createdAt: iso(r.created_at),
    lastLoginAt: iso(r.last_login_at),
    jobs: r.jobs,
    searches: r.searches,
    applications: r.applications,
  }));
}

/** Removes an account and everything saved under it. The owner cannot be deleted. */
export async function deleteUser(id: string): Promise<boolean> {
  const rows = await q('SELECT is_owner FROM users WHERE id = $1', [id]);
  if (!rows.length) return false;
  if (rows[0].is_owner) throw new Error('The owner account cannot be deleted.');
  await q('DELETE FROM run_jobs WHERE job_id IN (SELECT id FROM jobs WHERE user_id = $1)', [id]);
  await q('DELETE FROM search_jobs WHERE search_id IN (SELECT id FROM searches WHERE user_id = $1)', [id]);
  await q('DELETE FROM applications WHERE user_id = $1', [id]);
  await q('DELETE FROM jobs WHERE user_id = $1', [id]);
  await q('DELETE FROM searches WHERE user_id = $1', [id]); // search_runs go with them
  await q('DELETE FROM kv WHERE key LIKE $1', [`u:${id}:%`]);
  await q('DELETE FROM users WHERE id = $1', [id]);
  return true;
}

// ---- Apify token: each person runs searches on their own Apify account ----

function tokenKey(): Buffer {
  return createHash('sha256').update(`jobhunt-apify|${requireEnv('AUTH_SECRET', 32)}`).digest();
}

function seal(text: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', tokenKey(), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return `v1.${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}

function unseal(blob: string): string | null {
  try {
    const [v, iv, tag, enc] = blob.split('.');
    if (v !== 'v1') return null;
    const d = createDecipheriv('aes-256-gcm', tokenKey(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null; // AUTH_SECRET changed: ask for the token again
  }
}

export async function setApifyToken(uid: string, token: string | null): Promise<void> {
  await q('UPDATE users SET apify_token_enc = $2 WHERE id = $1', [uid, token ? seal(token.trim()) : null]);
}

export interface ApifyStatus {
  /** Where searches will get their token from. */
  source: 'own' | 'server' | 'none';
  last4: string | null;
}

/** The token a person's searches run with: their own, or for the owner only, the server's APIFY_TOKEN. */
export async function apifyTokenFor(uid: string): Promise<{ token: string; status: ApifyStatus } | null> {
  const rows = await q('SELECT is_owner, apify_token_enc FROM users WHERE id = $1', [uid]);
  if (!rows.length) return null;
  const own = rows[0].apify_token_enc ? unseal(rows[0].apify_token_enc) : null;
  if (own) return { token: own, status: { source: 'own', last4: own.slice(-4) } };
  const server = env('APIFY_TOKEN');
  if (rows[0].is_owner && server) return { token: server, status: { source: 'server', last4: null } };
  return null;
}

export async function apifyStatus(uid: string): Promise<ApifyStatus> {
  return (await apifyTokenFor(uid))?.status ?? { source: 'none', last4: null };
}

export const NEEDS_TOKEN = 'Add your own Apify API token in Settings before searching. Searches run on your Apify account.';
