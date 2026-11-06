import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { cookies, headers } from 'next/headers';
import { requireEnv } from './env';
import { q } from './db';
import { getUserById, type User } from './users';

export const SESSION_COOKIE = 'jh_session';
const SESSION_DAYS = 30;

function key(): Uint8Array {
  return new TextEncoder().encode(requireEnv('AUTH_SECRET', 32));
}

export async function signJwt(
  payload: JWTPayload & Record<string, unknown>,
  opts: { typ: string; aud?: string; iss?: string; expiresInSec?: number; jti?: string },
): Promise<string> {
  let jwt = new SignJWT({ ...payload, typ: opts.typ }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt();
  if (opts.aud) jwt = jwt.setAudience(opts.aud);
  if (opts.iss) jwt = jwt.setIssuer(opts.iss);
  if (opts.jti) jwt = jwt.setJti(opts.jti);
  if (opts.expiresInSec) jwt = jwt.setExpirationTime(Math.floor(Date.now() / 1000) + opts.expiresInSec);
  return jwt.sign(key());
}

export async function verifyJwt(
  token: string,
  opts: { typ: string; aud?: string },
): Promise<JWTPayload & Record<string, any>> {
  const { payload } = await jwtVerify(token, key(), {
    algorithms: ['HS256'],
    ...(opts.aud ? { audience: opts.aud } : {}),
  });
  if (payload.typ !== opts.typ) throw new Error('wrong token type');
  return payload as JWTPayload & Record<string, any>;
}

// ---- rate limiting ----

export function clientIp(h: Headers): string {
  return (h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? 'unknown').split(',')[0].trim();
}

/** True when `key` has already failed `max` times in the last `windowMin` minutes. Keys: ip:…, user:…, signup:… */
export async function tooMany(key: string, max = 8, windowMin = 15): Promise<boolean> {
  const rows = await q(`SELECT count(*)::int AS n FROM login_attempts WHERE ip = $1 AND at > now() - ($2 || ' minutes')::interval`, [key, String(windowMin)]);
  return (rows[0]?.n ?? 0) >= max;
}

export async function recordAttempt(key: string): Promise<void> {
  await q('INSERT INTO login_attempts (ip) VALUES ($1)', [key]);
  await q(`DELETE FROM login_attempts WHERE at < now() - interval '1 day'`);
}

export async function clearAttempts(key: string): Promise<void> {
  await q('DELETE FROM login_attempts WHERE ip = $1', [key]);
}

// ---- web session ----

export interface Session {
  uid: string;
  username: string;
  isOwner: boolean;
}

export async function createSessionCookie(user: User): Promise<{ name: string; value: string; options: Record<string, unknown> }> {
  const value = await signJwt({ sub: user.id, pv: user.pv }, { typ: 'session', expiresInSec: SESSION_DAYS * 86400 });
  return {
    name: SESSION_COOKIE,
    value,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_DAYS * 86400,
    },
  };
}

/** The signed-in person, or null. Checked against the database, so a changed password or deleted account ends the session. */
export async function getSession(): Promise<Session | null> {
  try {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const p = await verifyJwt(token, { typ: 'session' });
    if (typeof p.sub !== 'string') return null;
    const user = await getUserById(p.sub);
    if (!user || user.pv !== p.pv) return null;
    return { uid: user.id, username: user.username, isOwner: user.isOwner };
  } catch {
    return null;
  }
}

export async function sameOriginOk(req: Request): Promise<boolean> {
  // Cookie-authenticated mutations must come from our own pages.
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const origin = req.headers.get('origin');
  if (!origin) return true; // non-browser clients
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Standard guard for UI API routes: a Session, or the Response to send back. */
export async function guard(req: Request): Promise<{ session: Session } | { denied: Response }> {
  const session = await getSession();
  if (!session) return { denied: Response.json({ error: 'Not signed in.' }, { status: 401 }) };
  if (!(await sameOriginOk(req))) return { denied: Response.json({ error: 'Cross-site request blocked.' }, { status: 403 }) };
  return { session };
}

// ---- single-use tokens (authorization codes, refresh tokens) ----

export async function consumeOnce(jti: string, expSec: number): Promise<boolean> {
  try {
    await q('INSERT INTO used_tokens (jti, expires_at) VALUES ($1, to_timestamp($2))', [jti, expSec]);
    await q('DELETE FROM used_tokens WHERE expires_at < now()');
    return true;
  } catch {
    return false;
  }
}
