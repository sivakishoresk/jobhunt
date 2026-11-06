import { createHash, randomBytes } from 'node:crypto';
import { env } from './env';
import { signJwt, verifyJwt, consumeOnce } from './auth';
import { safeEqual } from './util';
import { getUserById, type User } from './users';

export const SCOPE = 'jobhunt';
export const ACCESS_TTL = 3600;
export const REFRESH_TTL = 30 * 86400;
export const CODE_TTL = 300;

export function resourceUrl(base: string): string {
  return `${base}/api/mcp`;
}

const BUILTIN_HOSTS = ['claude.ai', 'claude.com'];

export function isAllowedRedirect(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  const host = u.hostname.toLowerCase();
  if (u.protocol === 'http:') return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  if (u.protocol !== 'https:') return false;
  const extra = env('OAUTH_REDIRECT_HOSTS')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...BUILTIN_HOSTS, ...extra].some((h) => host === h || host.endsWith('.' + h));
}

export interface Client {
  id: string;
  name: string;
  redirectUris: string[] | 'any-allowed';
  secret?: string;
}

export async function registerClient(meta: { client_name?: string; redirect_uris?: unknown }): Promise<
  { ok: true; client_id: string; name: string; redirect_uris: string[] } | { ok: false; error: string }
> {
  const uris = Array.isArray(meta.redirect_uris) ? meta.redirect_uris.filter((x): x is string => typeof x === 'string') : [];
  if (!uris.length) return { ok: false, error: 'redirect_uris is required' };
  if (uris.length > 5) return { ok: false, error: 'too many redirect_uris' };
  for (const u of uris) if (!isAllowedRedirect(u)) return { ok: false, error: `redirect_uri not allowed: ${u}` };
  const name = (meta.client_name ?? 'MCP client').toString().slice(0, 80);
  const client_id = await signJwt({ name, redirect_uris: uris }, { typ: 'client' });
  return { ok: true, client_id, name, redirect_uris: uris };
}

export async function loadClient(clientId: string): Promise<Client | null> {
  const staticId = env('OAUTH_CLIENT_ID');
  if (staticId && safeEqual(clientId, staticId)) {
    return { id: clientId, name: 'Configured client', redirectUris: 'any-allowed', secret: env('OAUTH_CLIENT_SECRET') || undefined };
  }
  try {
    const p = await verifyJwt(clientId, { typ: 'client' });
    return { id: clientId, name: String(p.name ?? 'MCP client'), redirectUris: p.redirect_uris as string[] };
  } catch {
    return null;
  }
}

export function redirectAllowedFor(client: Client, uri: string): boolean {
  if (!isAllowedRedirect(uri)) return false;
  return client.redirectUris === 'any-allowed' ? true : client.redirectUris.includes(uri);
}

export function s256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export async function issueCode(args: {
  uid: string;
  pv: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  base: string;
}): Promise<string> {
  return signJwt(
    { cid: args.clientId, ru: args.redirectUri, cc: args.codeChallenge, res: args.resource, uid: args.uid, pv: args.pv },
    { typ: 'code', iss: args.base, expiresInSec: CODE_TTL, jti: randomBytes(12).toString('hex') },
  );
}

export async function issueTokens(args: { clientId: string; resource: string; base: string; uid: string; pv: string }) {
  const access = await signJwt({ cid: args.clientId, scope: SCOPE, uid: args.uid, pv: args.pv }, {
    typ: 'access',
    aud: args.resource,
    iss: args.base,
    expiresInSec: ACCESS_TTL,
  });
  const refresh = await signJwt({ cid: args.clientId, res: args.resource, scope: SCOPE, uid: args.uid, pv: args.pv }, {
    typ: 'refresh',
    iss: args.base,
    expiresInSec: REFRESH_TTL,
    jti: randomBytes(12).toString('hex'),
  });
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL, refresh_token: refresh, scope: SCOPE };
}

/** The user a code or token was issued to, if they still exist and have not changed their password since. */
async function currentUser(p: Record<string, any>): Promise<User | null> {
  if (typeof p.uid !== 'string' || typeof p.pv !== 'string') return null;
  const u = await getUserById(p.uid);
  return u && u.pv === p.pv ? u : null;
}

export type TokenResult = { ok: true; body: Record<string, unknown> } | { ok: false; error: string; description: string };

export async function exchange(form: URLSearchParams, base: string, basicAuth?: { id: string; secret: string }): Promise<TokenResult> {
  const grant = form.get('grant_type');
  const clientId = form.get('client_id') ?? basicAuth?.id ?? '';
  const secret = form.get('client_secret') ?? basicAuth?.secret ?? '';
  const client = clientId ? await loadClient(clientId) : null;
  if (!client) return { ok: false, error: 'invalid_client', description: 'Unknown client.' };
  if (client.secret && !safeEqual(secret, client.secret)) {
    return { ok: false, error: 'invalid_client', description: 'Wrong client secret.' };
  }
  const resource = resourceUrl(base);

  if (grant === 'authorization_code') {
    const code = form.get('code') ?? '';
    const verifier = form.get('code_verifier') ?? '';
    const redirectUri = form.get('redirect_uri') ?? '';
    let p;
    try {
      p = await verifyJwt(code, { typ: 'code' });
    } catch {
      return { ok: false, error: 'invalid_grant', description: 'Code is invalid or expired.' };
    }
    if (p.cid !== client.id || p.ru !== redirectUri) {
      return { ok: false, error: 'invalid_grant', description: 'Code does not match this client or redirect_uri.' };
    }
    if (!verifier || s256(verifier) !== p.cc) {
      return { ok: false, error: 'invalid_grant', description: 'PKCE verification failed.' };
    }
    const reqResource = form.get('resource');
    if (reqResource && reqResource.replace(/\/+$/, '') !== String(p.res).replace(/\/+$/, '')) {
      return { ok: false, error: 'invalid_target', description: 'resource does not match the authorization request.' };
    }
    if (!(await consumeOnce(String(p.jti), Number(p.exp)))) {
      return { ok: false, error: 'invalid_grant', description: 'Code was already used.' };
    }
    const who = await currentUser(p);
    if (!who) return { ok: false, error: 'invalid_grant', description: 'This sign-in is no longer valid. Connect again.' };
    return { ok: true, body: await issueTokens({ clientId: client.id, resource, base, uid: who.id, pv: who.pv }) };
  }

  if (grant === 'refresh_token') {
    let p;
    try {
      p = await verifyJwt(form.get('refresh_token') ?? '', { typ: 'refresh' });
    } catch {
      return { ok: false, error: 'invalid_grant', description: 'Refresh token is invalid or expired.' };
    }
    if (p.cid !== client.id) return { ok: false, error: 'invalid_grant', description: 'Refresh token belongs to another client.' };
    if (!(await consumeOnce(String(p.jti), Number(p.exp)))) {
      return { ok: false, error: 'invalid_grant', description: 'Refresh token was already used.' };
    }
    const who = await currentUser(p);
    if (!who) return { ok: false, error: 'invalid_grant', description: 'This sign-in is no longer valid (password changed or account removed). Connect again.' };
    return { ok: true, body: await issueTokens({ clientId: client.id, resource, base, uid: who.id, pv: who.pv }) };
  }

  return { ok: false, error: 'unsupported_grant_type', description: 'Use authorization_code or refresh_token.' };
}

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id',
};
