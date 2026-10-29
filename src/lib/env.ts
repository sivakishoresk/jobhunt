export function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

export function requireEnv(name: string, minLength = 1): string {
  const v = env(name);
  if (v.length < minLength) {
    throw new Error(
      minLength > 1
        ? `${name} must be set and at least ${minLength} characters long.`
        : `${name} is not set.`,
    );
  }
  return v;
}

export function apifyBase(): string {
  return (env('APIFY_API_BASE') || 'https://api.apify.com').replace(/\/+$/, '');
}

/** Public origin of this app, without a trailing slash. */
export function baseUrl(req: Request): string {
  const fixed = env('APP_URL');
  if (fixed) return fixed.replace(/\/+$/, '');
  const h = req.headers;
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = (h.get('x-forwarded-proto') ?? (local ? 'http' : 'https')).split(',')[0].trim();
  return `${proto}://${host}`;
}
