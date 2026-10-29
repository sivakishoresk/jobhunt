import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { cookies, headers } from 'next/headers';
import { env, requireEnv } from './env';
import { q } from './db';
import { safeEqual } from './util';

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

// ---- password + rate limiting ----

export function passwordMatches(input: string): boolean {
  const pw = env('APP_PASSWORD');
  if (pw.length < 12) throw new Error('APP_PASSWORD must be set and at least 12 characters long.');
  return safeEqual(input, pw);
}

export function clientIp(h: Headers): string {
  return (h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? 'unknown').split(',')[0].trim();
}

const WINDOW_MIN = 15;
const MAX_FAILS = 8;

export async function tooManyAttempts(ip: string): Promise<boolean> {
  const rows = await q(
    `SELECT count(*)::int AS n FROM login_attempts WHERE ip = $1 AND at > now() - interval '${WINDOW_MIN} minutes'`,
    [ip],
  );
  return (rows[0]?.n ?? 0) >= MAX_FAILS;
}

export async function recordFailure(ip: string): Promise<void> {
  await q('INSERT INTO login_attempts (ip) VALUES ($1)', [ip]);
  await q(`DELETE FROM login_attempts WHERE at < now() - interval '1 day'`);
}

// ---- web session ----

export async function createSessionCookie(): Promise<{ name: string; value: string; options: Record<string, unknown> }> {
  const value = await signJwt({ sub: 'owner' }, { typ: 'session', expiresInSec: SESSION_DAYS * 86400 });
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

export async function isLoggedIn(): Promise<boolean> {
  try {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (!token) return false;
    await verifyJwt(token, { typ: 'session' });
    return true;
  } catch {
    return false;
  }
}

/** For API route handlers: returns a 401 Response when not signed in, otherwise null. */
export async function requireSession(): Promise<Response | null> {
  if (await isLoggedIn()) return null;
  return Response.json({ error: 'Not signed in.' }, { status: 401 });
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

/** Standard guard for UI API routes. */
export async function guard(req: Request): Promise<Response | null> {
  const denied = await requireSession();
  if (denied) return denied;
  if (!(await sameOriginOk(req))) return Response.json({ error: 'Cross-site request blocked.' }, { status: 403 });
  return null;
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
