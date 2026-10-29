import { baseUrl, env } from './env';
import { verifyJwt } from './auth';
import { resourceUrl, CORS } from './oauth';
import { safeEqual } from './util';

export async function authenticateMcp(req: Request): Promise<{ ok: true } | { ok: false; response: Response }> {
  const base = baseUrl(req);
  const challenge = (error?: string) =>
    new Response(JSON.stringify({ error: error ?? 'unauthorized' }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/api/mcp"${
          error ? `, error="invalid_token"` : ''
        }`,
        ...CORS,
      },
    });

  const header = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return { ok: false, response: challenge() };
  const token = m[1].trim();

  const fixed = env('MCP_API_TOKEN');
  if (fixed.length >= 32 && safeEqual(token, fixed)) return { ok: true };

  try {
    await verifyJwt(token, { typ: 'access', aud: resourceUrl(base) });
    return { ok: true };
  } catch {
    return { ok: false, response: challenge('invalid_token') };
  }
}
