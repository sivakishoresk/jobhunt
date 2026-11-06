import { baseUrl } from '@/lib/env';
import { clearAttempts, clientIp, recordAttempt, tooMany } from '@/lib/auth';
import { normalizeUsername, verifyLogin } from '@/lib/users';
import { issueCode, loadClient, redirectAllowedFor, resourceUrl, SCOPE, type Client } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'; default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https: http://localhost:* http://127.0.0.1:*",
  'Referrer-Policy': 'no-referrer',
};

function page(body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect to Jobhunt</title>
<style>
:root{color-scheme:light dark;--paper:#f2f4f3;--ink:#17202a;--mute:#5b6773;--rule:#d5dad8;--blue:#2b3fd6;--bad:#b3261e}
@media (prefers-color-scheme:dark){:root{--paper:#11151a;--ink:#e8ecef;--mute:#9aa6b1;--rule:#2a323a;--blue:#8c9bff;--bad:#ff8a80}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--paper);color:var(--ink);font:16px/1.5 "Schibsted Grotesk",system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:min(30rem,100% - 2rem);padding:2rem 0}
h1{font-size:1.5rem;line-height:1.2;margin:0 0 .5rem;letter-spacing:-.01em}
p{margin:.5rem 0;color:var(--mute)}ul{margin:.75rem 0 1.25rem;padding-left:1.1rem}li{margin:.25rem 0}
.who{padding:.75rem 0;border-block:1px solid var(--rule);margin:1rem 0}.who b{color:var(--ink)}
label{display:block;font-weight:600;margin:1rem 0 .25rem}
input[type=password],input[type=text]{width:100%;font:inherit;padding:.6rem .7rem;border:1px solid var(--rule);border-radius:3px;background:transparent;color:inherit}
input:focus-visible,button:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.row{display:flex;gap:.75rem;margin-top:1.25rem}
button{font:inherit;font-weight:600;padding:.6rem 1rem;border-radius:3px;border:1px solid var(--rule);background:transparent;color:inherit;cursor:pointer}
button.go{background:var(--blue);border-color:var(--blue);color:#fff}
.err{color:var(--bad);font-weight:600}
</style></head><body><main>${body}</main></body></html>`;
  return new Response(html, { status, headers: HEADERS });
}

interface Params {
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  resource: string;
  response_type: string;
}

function readParams(get: (k: string) => string | null): Params {
  const g = (k: string) => get(k) ?? '';
  return {
    client_id: g('client_id'),
    redirect_uri: g('redirect_uri'),
    state: g('state'),
    code_challenge: g('code_challenge'),
    code_challenge_method: g('code_challenge_method'),
    resource: g('resource'),
    response_type: g('response_type'),
  };
}

async function validate(p: Params): Promise<{ ok: true; client: Client } | { ok: false; response: Response }> {
  const bad = (msg: string) => ({
    ok: false as const,
    response: page(`<h1>This link can't be used</h1><p>${esc(msg)}</p><p>Go back to Claude and start the connection again.</p>`, 400),
  });
  const client = p.client_id ? await loadClient(p.client_id) : null;
  if (!client) return bad('The app asking for access is not registered.');
  if (!p.redirect_uri || !redirectAllowedFor(client, p.redirect_uri)) return bad('The return address is not one this app registered.');
  if (p.response_type !== 'code') return bad('Only the authorization code flow is supported.');
  if (!p.code_challenge || p.code_challenge_method !== 'S256') return bad('PKCE with S256 is required.');
  return { ok: true, client };
}

function form(p: Params, client: Client, error?: string, username = ''): Response {
  const hidden = Object.entries(p)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('');
  let host = '';
  try {
    host = new URL(p.redirect_uri).host;
  } catch {
    /* validated earlier */
  }
  return page(`
<h1>Connect Claude to Jobhunt</h1>
<p>Only continue if you just added this connector yourself.</p>
<div class="who"><b>${esc(client.name)}</b> will return to <b>${esc(host)}</b></div>
<p>It will be able to:</p>
<ul>
  <li>search for jobs with the Apify token saved on your account, which can cost money</li>
  <li>read your profile (without contact details) and your jobs and applications. It only sees your own.</li>
  <li>save fit scores, change a job's state, and save draft resumes and cover letters</li>
</ul>
<p>It can't send applications, and it can't delete anything.</p>
<form method="post">
  ${hidden}
  <label for="un">Jobhunt username</label>
  <input id="un" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" value="${esc(username)}" required ${username ? '' : 'autofocus'}>
  <label for="pw">Password</label>
  <input id="pw" name="password" type="password" autocomplete="current-password" required ${username ? 'autofocus' : ''}>
  ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
  <div class="row"><button class="go" name="decision" value="allow">Allow access</button><button name="decision" value="deny" formnovalidate>Cancel</button></div>
</form>`, error ? 401 : 200);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const p = readParams((k) => url.searchParams.get(k));
  const v = await validate(p);
  if (!v.ok) return v.response;
  return form(p, v.client);
}

export async function POST(req: Request) {
  const data = await req.formData();
  const p = readParams((k) => {
    const x = data.get(k);
    return typeof x === 'string' ? x : null;
  });
  const v = await validate(p);
  if (!v.ok) return v.response;

  const back = (params: Record<string, string>) => {
    const u = new URL(p.redirect_uri);
    for (const [k, val] of Object.entries(params)) u.searchParams.set(k, val);
    if (p.state) u.searchParams.set('state', p.state);
    return new Response(null, { status: 302, headers: { Location: u.toString(), 'Cache-Control': 'no-store' } });
  };

  if (data.get('decision') === 'deny') return back({ error: 'access_denied' });

  const username = normalizeUsername(String(data.get('username') ?? ''));
  const ipKey = `ip:${clientIp(req.headers)}`;
  const userKey = `user:${username.slice(0, 60)}`;
  if ((await tooMany(ipKey, 20)) || (await tooMany(userKey, 8))) return form(p, v.client, 'Too many wrong attempts. Wait 15 minutes and try again.', username);
  const pw = String(data.get('password') ?? '');
  let user = null;
  try {
    user = username && pw.length <= 200 ? await verifyLogin(username, pw) : null;
  } catch (e) {
    return page(`<h1>Not set up yet</h1><p>${esc(e instanceof Error ? e.message : 'Server is not configured.')}</p>`, 500);
  }
  if (!user) {
    await recordAttempt(ipKey);
    await recordAttempt(userKey);
    return form(p, v.client, 'That username and password do not match.', username);
  }
  await clearAttempts(userKey);

  const base = baseUrl(req);
  const code = await issueCode({
    uid: user.id,
    pv: user.pv,
    clientId: v.client.id,
    redirectUri: p.redirect_uri,
    codeChallenge: p.code_challenge,
    resource: p.resource || resourceUrl(base),
    base,
  });
  void SCOPE;
  return back({ code, iss: base });
}
