// End-to-end test: mock Apify + the built app + OAuth + MCP tools + UI API + browser.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const require = createRequire(import.meta.url);
const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const PASSWORD = 'correct horse battery';
const STATIC_TOKEN = 'static-token-static-token-static-token-1234';
const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: String(PORT),
  APP_PASSWORD: PASSWORD,
  AUTH_SECRET: 'test-secret-test-secret-test-secret-test-secret',
  APIFY_TOKEN: 'test-token',
  APIFY_API_BASE: 'http://localhost:4010',
  APIFY_MAX_CHARGE_USD: '2',
  MCP_API_TOKEN: STATIC_TOKEN,
  LOCAL_DB_DIR: '.data/e2e-pglite',
  MOCK_DELAY_MS: '4000',
};
fs.rmSync('.data/e2e-pglite', { recursive: true, force: true });
fs.mkdirSync('test-output', { recursive: true });

const procs = [];
function start(cmd, args, name) {
  const p = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  p.stdout.on('data', (d) => process.env.E2E_VERBOSE && process.stdout.write(`[${name}] ${d}`));
  p.stderr.on('data', (d) => process.stderr.write(`[${name}!] ${d}`));
  procs.push(p);
  return p;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${url}`);
}

let pass = 0;
const failures = [];
async function step(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${e?.message ?? e}`);
  }
}
const ok = (c, m) => {
  if (!c) throw new Error(m ?? 'assertion failed');
};
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m ?? 'not equal'}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const b64 = (b) => Buffer.from(b).toString('base64url');
const verifier = b64(crypto.randomBytes(32));
const challenge = b64(crypto.createHash('sha256').update(verifier).digest());
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

const SAMPLE_PROFILE = {
  basics: { name: 'Asha Rao', headline: 'ML engineer building LLM evaluation tools', email: 'asha@example.com', phone: '+91 90000 00000', location: 'Bengaluru, India', summary: 'ML engineer with 2 years of experience in LLM evaluation and training.', links: [{ label: 'GitHub', url: 'https://github.com/asharao' }] },
  skills: ['Python', 'PyTorch', 'LLM evaluation', 'Docker'],
  experience: [
    { title: 'AI Engineer', company: 'Fabrikam Research', location: 'Mumbai', start: 'Jun 2024', end: 'Nov 2025', bullets: ['Trained a **14B** reasoning model for under **$500**', 'Built an evaluation harness used by 6 teams'] },
    { title: 'Data Scientist', company: 'Contoso Health', location: 'Bengaluru', start: 'Feb 2026', end: 'Mar 2026', bullets: ['Cleaned claims data with Python'] },
  ],
  projects: [{ name: 'Open reasoning model', link: 'https://example.com/model', start: '2025', end: '2025', bullets: ['Released weights and a training recipe'] }],
  education: [{ degree: 'B.Tech, Computer Science', school: 'Example Institute of Technology', start: '2020', end: '2024', detail: 'CGPA 8.1' }],
  publications: [{ citation: 'Rao, A. (2025). A Study of Reasoning. ICLR Poster.' }],
};

async function main() {
  console.log('Starting mock Apify and the app…');
  start('node', ['scripts/mock-apify.mjs'], 'mock');
  start('npx', ['next', 'start', '-p', String(PORT)], 'next');
  await waitFor('http://localhost:4010/__log');
  await waitFor(`${BASE}/login`);

  console.log('\nDiscovery and auth');
  let access, refresh, clientId;
  await step('MCP without a token is a 401 that points at the metadata', async () => {
    const r = await fetch(`${BASE}/api/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    eq(r.status, 401);
    ok(/resource_metadata="http:\/\/localhost:3100\/\.well-known\/oauth-protected-resource\/api\/mcp"/.test(r.headers.get('www-authenticate') ?? ''), 'bad WWW-Authenticate: ' + r.headers.get('www-authenticate'));
  });
  await step('protected resource metadata', async () => {
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/mcp']) {
      const j = await (await fetch(BASE + path)).json();
      eq(j.resource, `${BASE}/api/mcp`);
      eq(j.authorization_servers, [BASE]);
    }
  });
  await step('authorization server metadata', async () => {
    const j = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
    eq(j.code_challenge_methods_supported, ['S256']);
    ok(j.registration_endpoint.endsWith('/oauth/register'));
  });
  await step('dynamic registration accepts claude.ai and rejects other hosts', async () => {
    const good = await fetch(`${BASE}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT] }) });
    eq(good.status, 201);
    clientId = (await good.json()).client_id;
    const bad = await fetch(`${BASE}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Evil', redirect_uris: ['https://evil.example/cb'] }) });
    eq(bad.status, 400);
    const local = await fetch(`${BASE}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'CLI', redirect_uris: ['http://localhost:54321/callback'] }) });
    eq(local.status, 201);
  });

  const authParams = () => ({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', resource: `${BASE}/api/mcp` });
  let code;
  await step('authorize page renders and blocks framing', async () => {
    const r = await fetch(`${BASE}/oauth/authorize?${new URLSearchParams(authParams())}`);
    eq(r.status, 200);
    eq(r.headers.get('x-frame-options'), 'DENY');
    ok((await r.text()).includes('Allow access'));
  });
  await step('authorize refuses an unregistered redirect_uri', async () => {
    const r = await fetch(`${BASE}/oauth/authorize?${new URLSearchParams({ ...authParams(), redirect_uri: 'https://claude.ai/other' })}`);
    eq(r.status, 400);
  });
  await step('wrong password is refused', async () => {
    const r = await fetch(`${BASE}/oauth/authorize`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ ...authParams(), password: 'nope nope nope', decision: 'allow' }) });
    eq(r.status, 401);
  });
  await step('right password redirects with a code and state', async () => {
    const r = await fetch(`${BASE}/oauth/authorize`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ ...authParams(), password: PASSWORD, decision: 'allow' }) });
    eq(r.status, 302);
    const loc = new URL(r.headers.get('location'));
    eq(loc.origin + loc.pathname, REDIRECT);
    eq(loc.searchParams.get('state'), 'xyz');
    code = loc.searchParams.get('code');
    ok(code, 'no code');
  });
  const tokenReq = (extra) => fetch(`${BASE}/oauth/token`, { method: 'POST', body: new URLSearchParams({ client_id: clientId, ...extra }) });
  await step('token exchange rejects a bad PKCE verifier', async () => {
    const r = await tokenReq({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: 'wrong-verifier-wrong-verifier-wrong-verifier' });
    eq(r.status, 400);
  });
  await step('token exchange with the right verifier works once', async () => {
    const r = await tokenReq({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: verifier, resource: `${BASE}/api/mcp` });
    eq(r.status, 200);
    const j = await r.json();
    access = j.access_token;
    refresh = j.refresh_token;
    ok(access && refresh);
    const again = await tokenReq({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: verifier });
    eq(again.status, 400, 'code reuse should fail');
  });
  await step('refresh rotates and the old refresh token dies', async () => {
    const r = await tokenReq({ grant_type: 'refresh_token', refresh_token: refresh });
    eq(r.status, 200);
    const j = await r.json();
    const old = await tokenReq({ grant_type: 'refresh_token', refresh_token: refresh });
    eq(old.status, 400);
    access = j.access_token;
  });
  await step('a made-up bearer token is rejected', async () => {
    const r = await fetch(`${BASE}/api/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer abc.def.ghi' }, body: '{}' });
    eq(r.status, 401);
  });

  console.log('\nMCP tools (OAuth token)');
  const client = new Client({ name: 'e2e', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), { requestInit: { headers: { Authorization: `Bearer ${access}` } } }));
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const text = r.content?.[0]?.text ?? '{}';
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { isError: !!r.isError, data };
  };

  await step('lists all tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    for (const n of ['get_profile', 'update_profile', 'search_jobs', 'get_search', 'list_jobs', 'get_job', 'add_job', 'score_jobs', 'set_job_state', 'check_draft', 'save_application', 'list_applications', 'get_application', 'set_application_status'])
      ok(names.includes(n), `missing tool ${n}`);
    ok(tools.every((t) => t.annotations), 'tools should carry annotations');
    console.log(`      ${names.length} tools`);
  });
  await step('empty profile says so', async () => {
    const r = await call('get_profile');
    eq(r.data.empty, true);
  });
  await step('saving a draft with an empty profile is refused', async () => {
    const r = await call('save_application', { job_id: 'j_nope', cover_letter: 'x' });
    ok(r.isError);
  });
  let ids;
  await step('update_profile assigns ids; get_profile hides contact details', async () => {
    const u = await call('update_profile', SAMPLE_PROFILE);
    ok(!u.isError, JSON.stringify(u.data));
    const g = (await call('get_profile')).data;
    eq(g.experience.map((e) => e.id), ['exp-1', 'exp-2']);
    eq(g.education[0].id, 'edu-1');
    eq(g.publications[0].id, 'pub-1');
    ok(!('email' in g.basics) && !('phone' in g.basics) && !('links' in g.basics), 'contact details leaked');
    ok(!JSON.stringify(g).includes('asha@example.com'));
    ids = g;
  });

  let searchId, jobs;
  await step('search_jobs runs both sources and waits for results', async () => {
    const t0 = Date.now();
    const r = await call('search_jobs', { keywords: 'machine learning engineer', location: 'Bengaluru', posted_within_days: 7 });
    ok(!r.isError, JSON.stringify(r.data));
    searchId = r.data.search_id;
    eq(r.data.status, 'done', 'search should be done: ' + JSON.stringify(r.data.sources));
    console.log(`      finished in ${Math.round((Date.now() - t0) / 1000)}s; ${JSON.stringify(r.data.sources)}`);
    jobs = r.data.jobs;
    ok(jobs.length >= 10, 'expected many jobs, got ' + jobs.length);
    ok(jobs.every((j) => j.id.startsWith('j_')));
  });
  await step('Apify received rendered inputs, with typed values and the spend cap', async () => {
    const log = await (await fetch('http://localhost:4010/__log')).json();
    const li = log.find((l) => l.actor === 'curious_coder/linkedin-jobs-scraper');
    ok(li, 'no linkedin call');
    eq(typeof li.input.count, 'number', 'count should be a number');
    const u = new URL(li.input.urls[0]);
    eq(u.searchParams.get('keywords'), 'machine learning engineer');
    eq(u.searchParams.get('location'), 'Bengaluru');
    eq(u.searchParams.get('f_TPR'), 'r604800');
    eq(li.query.maxTotalChargeUsd, '2');
    const yc = log.find((l) => l.actor === 'tqm/ycombinator-scraper');
    eq(typeof yc.input.remoteOnly, 'boolean');
    eq(yc.input.maxJobs, 50);
  });
  await step('duplicates merged and the title-less item skipped', async () => {
    const r = await call('list_jobs', { state: 'all', source: 'linkedin', limit: 100 });
    eq(r.data.total, 12, 'linkedin should have 12 unique jobs');
  });
  await step('the YC source filtered by keywords locally', async () => {
    const r = await call('list_jobs', { state: 'all', source: 'yc', limit: 100 });
    ok(r.data.total > 0 && r.data.total <= 10, 'yc total ' + r.data.total);
  });
  await step('searching again finds no new rows (dedupe across searches)', async () => {
    const r = await call('search_jobs', { keywords: 'machine learning engineer', location: 'Bengaluru', sources: ['linkedin'] });
    eq(r.data.status, 'done');
    eq(r.data.sources[0].new, 0, 'second search should add nothing');
  });
  let jobA, jobB;
  await step('get_job returns a clean description; HTML was stripped', async () => {
    const li = (await call('list_jobs', { source: 'linkedin', limit: 5, sort: 'newest' })).data.jobs;
    jobA = li[0].id;
    const g = (await call('get_job', { job_id: jobA })).data;
    ok(g.description.includes('Python and PyTorch') && !g.description.includes('<li>'), g.description);
    ok(g.url.startsWith('https://www.linkedin.com/jobs/view/'));
    jobB = li[1].id;
  });
  await step('score_jobs saves scores and list_jobs sorts by them', async () => {
    const s = await call('score_jobs', { scores: [{ job_id: jobA, score: 91, reasons: ['Matches LLM work'], flags: ['5+ years asked'] }, { job_id: jobB, score: 40 }, { job_id: 'j_missing', score: 10 }] });
    eq(s.data.saved, 2);
    eq(s.data.unknown_job_ids, ['j_missing']);
    const l = (await call('list_jobs', { sort: 'score', limit: 3 })).data.jobs;
    eq(l[0].id, jobA);
    eq(l[0].score, 91);
    const unscored = (await call('list_jobs', { unscored_only: true, limit: 100 })).data;
    ok(unscored.jobs.every((j) => j.score === undefined));
  });
  await step('set_job_state dismisses and the default list hides it', async () => {
    await call('set_job_state', { job_ids: [jobB], state: 'dismissed' });
    const l = (await call('list_jobs', { limit: 100 })).data.jobs;
    ok(!l.some((j) => j.id === jobB));
  });

  const draft = (extra = {}) => ({
    job_id: jobA,
    summary: 'ML engineer with 2 years of experience in LLM evaluation.',
    skills: ['Python', 'PyTorch'],
    experience: [{ profile_id: 'exp-1', bullets: ['Trained a **14B** reasoning model for under **$500**', 'Built an evaluation harness used by 6 teams'] }],
    projects: [{ profile_id: 'proj-1', bullets: ['Released weights and a training recipe'] }],
    education: ['edu-1'],
    publications: ['pub-1'],
    cover_letter: 'Dear hiring team,\n\nI trained a 14B model for under $500 at Fabrikam Research.\n\nSincerely,\nAsha Rao',
    gaps: ['Posting wants 5+ years; profile shows about 2'],
    ...extra,
  });
  await step('check_draft passes a faithful draft', async () => {
    const r = await call('check_draft', draft());
    eq(r.data.ok, true);
    eq(r.data.warnings, [], JSON.stringify(r.data.warnings));
  });
  await step('check_draft flags invented numbers, tools, skills and employers', async () => {
    const r = await call('check_draft', draft({
      experience: [{ profile_id: 'exp-1', bullets: ['Cut inference cost by **73%** using Kubernetes at Google'] }],
      skills: ['Python', 'Rust'],
      cover_letter: 'Dear team,\n\nI led 12 engineers and shipped with Terraform.',
    }));
    const text = JSON.stringify(r.data.warnings);
    ok(text.includes('73%'), 'missing 73%: ' + text);
    ok(text.includes('Kubernetes'), 'missing Kubernetes');
    ok(text.includes('Google'), 'missing Google');
    ok(text.includes('Rust'), 'missing Rust skill');
    ok(text.includes('"12"'), 'missing 12');
    ok(text.includes('Terraform'), 'missing Terraform');
  });
  await step('unknown profile ids are blocked', async () => {
    const r = await call('save_application', draft({ experience: [{ profile_id: 'exp-9', bullets: ['x'] }] }));
    ok(r.isError);
    ok(JSON.stringify(r.data).includes('exp-9'));
  });
  let appId;
  await step('save_application stores a draft built from profile facts', async () => {
    const r = await call('save_application', draft());
    ok(!r.isError, JSON.stringify(r.data));
    appId = r.data.application_id;
    ok(r.data.review_at.endsWith(`/applications/${appId}`));
    const a = (await call('get_application', { application_id: appId })).data;
    eq(a.resume.experience[0].company, 'Fabrikam Research');
    eq(a.resume.experience[0].start, 'Jun 2024');
    eq(a.resume.contact, ['asha@example.com', '+91 90000 00000', 'Bengaluru, India', 'https://github.com/asharao']);
    eq(a.resume.publications, ['Rao, A. (2025). A Study of Reasoning. ICLR Poster.']);
    eq(a.status, 'draft');
  });
  await step('saving again updates the same draft', async () => {
    const r = await call('save_application', draft({ cover_letter: 'Dear team,\n\nUpdated.' }));
    eq(r.data.updated_existing_draft, true);
    eq(r.data.application_id, appId);
    eq((await call('list_applications')).data.applications.length, 1);
  });
  await step('set_application_status marks the job applied too', async () => {
    await call('set_application_status', { application_id: appId, status: 'sent', note: 'Applied via site' });
    const a = (await call('get_application', { application_id: appId })).data;
    eq(a.status, 'sent');
    ok(a.notes.includes('Applied via site'));
    ok(a.sent_at);
    const job = (await call('get_job', { job_id: jobA })).data;
    eq(job.state, 'applied');
    eq(job.applications[0].id, appId);
  });
  await step('add_job saves a pasted posting', async () => {
    const r = await call('add_job', { title: 'ML Engineer', company: 'Pasted Co', description: 'A pasted description that is long enough to count as a posting.' });
    ok(r.data.job_id);
    const again = await call('add_job', { title: 'ML Engineer', company: 'Pasted Co', description: 'A pasted description that is long enough to count as a posting.' });
    eq(again.data.duplicate, true);
  });

  console.log('\nFailure handling');
  const cookie = await (async () => {
    const bad = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'wrong wrong wrong' }) });
    eq(bad.status, 401);
    const r = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
    eq(r.status, 200);
    return r.headers.get('set-cookie').split(';')[0];
  })();
  const web = (path, init = {}) => fetch(BASE + path, { ...init, headers: { cookie, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  await step('failing, missing, rental and slow actors are reported clearly', async () => {
    const cur = (await (await web('/api/sources')).json()).sources;
    const add = (id, actor) => ({ id, label: id, enabled: true, preset: 'custom', actor, input: { q: '{{keywords}}' }, maxResults: 5, localKeywordFilter: false });
    const put = await web('/api/sources', { method: 'PUT', body: JSON.stringify([...cur.map((s) => ({ ...s, enabled: false })), add('failx', 'fail/x'), add('gone', 'missing/x'), add('paid', 'rental/x'), add('slow', 'slow/x')]) });
    eq(put.status, 200);
    const r = await call('search_jobs', { keywords: 'anything', sources: ['failx', 'gone', 'paid', 'slow'] });
    const by = Object.fromEntries(r.data.sources.map((s) => [s.source, s]));
    eq(by.slow.status, 'running');
    ok(r.data.note.includes('get_search'), 'should tell Claude to poll');
    eq(by.gone.status, 'failed'); ok(by.gone.error.includes('actor name'), by.gone.error);
    eq(by.paid.status, 'failed'); ok(/credit|rent/i.test(by.paid.error), by.paid.error);
    const later = await call('get_search', { search_id: r.data.search_id });
    eq(Object.fromEntries(later.data.sources.map((s) => [s.source, s.status])).failx, 'failed');
    ok(later.data.sources.find((s) => s.source === 'failx').error.includes('Actor crashed'));
    // restore
    await web('/api/sources', { method: 'PUT', body: JSON.stringify(cur) });
  });

  console.log('\nStatic bearer token and web API');
  await step('the fixed MCP_API_TOKEN also works', async () => {
    const c2 = new Client({ name: 'e2e2', version: '1' });
    await c2.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), { requestInit: { headers: { Authorization: `Bearer ${STATIC_TOKEN}` } } }));
    ok((await c2.listTools()).tools.length >= 14);
    await c2.close();
  });
  await step('the web API needs a session and rejects cross-site writes', async () => {
    eq((await fetch(`${BASE}/api/jobs`)).status, 401);
    const r = await web('/api/jobs/' + jobA, { method: 'PATCH', headers: { origin: 'https://evil.example' }, body: '{"state":"new"}' });
    eq(r.status, 403);
  });
  await step('web API lists jobs with snippets and patches a job', async () => {
    const j = await (await web('/api/jobs')).json();
    ok(j.jobs.length >= 10, 'got ' + j.jobs.length);
    ok(j.jobs.every((x) => typeof x.snippet === 'string'));
    const r = await web('/api/jobs/' + jobA, { method: 'PATCH', body: '{"notes":"Referral from Sam"}' });
    eq(r.status, 200);
    eq((await (await web('/api/jobs/' + jobA)).json()).notes, 'Referral from Sam');
  });
  await step('resume and cover letter download as real .docx files', async () => {
    for (const doc of ['resume', 'cover']) {
      const r = await web(`/api/applications/${appId}/docx?doc=${doc}`);
      eq(r.status, 200);
      ok((r.headers.get('content-disposition') ?? '').includes('.docx'));
      const buf = Buffer.from(await r.arrayBuffer());
      eq(buf.slice(0, 2).toString(), 'PK', 'docx should be a zip');
      fs.writeFileSync(`test-output/${doc}.docx`, buf);
    }
  });
  await step('source test endpoint shows raw and normalized items', async () => {
    const cur = (await (await web('/api/sources')).json()).sources;
    const r = await (await web('/api/sources/test', { method: 'POST', body: JSON.stringify({ source: cur[0], keywords: 'ml', location: '' }) })).json();
    eq(r.status, 'done');
    ok(r.normalized[0].title, JSON.stringify(r));
    ok(r.raw && r.input);
  });

  await client.close();

  console.log('\nBrowser');
  await browserTests(cookie, appId);
}

async function browserTests(cookie, appId) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const shot = (n) => page.screenshot({ path: `test-output/${n}.png` });

  await step('login page, wrong then right password', async () => {
    await page.goto(`${BASE}/`);
    ok(page.url().endsWith('/login'), 'should redirect to login: ' + page.url());
    await shot('01-login');
    await page.fill('#pw', 'wrong password here');
    await page.click('button:has-text("Sign in")');
    await page.waitForSelector('[role=alert]');
    await page.fill('#pw', PASSWORD);
    await page.click('button:has-text("Sign in")');
    await page.waitForURL(`${BASE}/`);
  });
  await step('the workbench lists jobs, with the first selected and detail shown', async () => {
    await page.waitForSelector('.row-job');
    ok((await page.locator('.row-job').count()) > 5);
    await page.waitForSelector('.detail h2');
    await shot('02-workbench');
  });
  await step('text filter narrows the list and highlights matches', async () => {
    const before = await page.locator('.row-job').count();
    const company = (await page.locator('.row-job').nth(2).locator('.rj-sub').innerText()).split(' · ')[0].trim().split(/\s+/)[0];
    await page.fill('input[aria-label="Filter jobs"]', company);
    await page.waitForTimeout(300);
    const after = await page.locator('.row-job').count();
    await page.fill('input[aria-label="Filter jobs"]', '');
    ok(after > 0 && after < before, `before ${before} after ${after} for "${company}"`);
    await shot('03-filtered');
  });
  await step('keyboard: j moves, s saves, x dismisses, u undoes', async () => {
    await page.locator('body').click({ position: { x: 700, y: 20 } });
    const sel = async () => page.locator('.row-job[aria-selected=true]').getAttribute('id');
    const first = await sel();
    await page.keyboard.press('j');
    const second = await sel();
    ok(first !== second, 'j should move selection');
    await page.keyboard.press('x');
    await page.waitForSelector('.toast');
    ok(!(await page.locator(`#${second}`).count()), 'dismissed row should leave the inbox');
    await page.keyboard.press('u');
    await page.waitForSelector(`#${second}`);
    await page.keyboard.press('s');
    await page.click('.tabs button:has-text("Saved")');
    await page.waitForSelector(`#${second}`);
    await page.click('.tabs button:has-text("Inbox")');
  });
  await step('score meter and fit panel show Claude\'s score', async () => {
    await page.selectOption('select[aria-label="Sort"]', 'score');
    await page.click('.tabs button:has-text("All")');
    await page.locator('.row-job').first().click();
    await page.waitForSelector('.fit b.num');
    ok((await page.locator('.meter.hi').count()) >= 1, 'a high score meter should be green');
    await shot('04-scored');
    await page.selectOption('select[aria-label="Sort"]', 'newest');
  });
  await step('searching from the page shows progress, then new rows', async () => {
    await page.fill('#kw', 'nlp engineer');
    await page.fill('#loc', 'Hyderabad');
    await page.click('button:has-text("Search")');
    await page.waitForSelector('.runs li');
    await shot('05-searching');
    await page.waitForSelector('.runs .st.done', { timeout: 30000 });
  });
  await step('the applications board shows the draft and drag changes status', async () => {
    await page.goto(`${BASE}/applications`);
    await page.waitForSelector('.item');
    await shot('06-board');
    const item = page.locator('.item').first();
    await item.dragTo(page.locator('.col', { hasText: 'Interview' }));
    await page.waitForFunction(() => document.querySelector('.col:nth-child(3) .item'));
  });
  await step('the editor renders the resume sheet and edits a bullet', async () => {
    await page.goto(`${BASE}/applications/${appId}`);
    await page.waitForSelector('.sheet h1');
    ok((await page.locator('.sheet').innerText()).includes('Fabrikam Research'));
    ok((await page.locator('.sheet strong', { hasText: '14B' }).count()) === 1, 'bold bullet should render');
    await page.fill('#eb0', 'Rewrote the **evaluation** harness');
    ok((await page.locator('.sheet strong', { hasText: 'evaluation' }).count()) === 1, 'preview should update');
    await page.click('button:has-text("Save changes")');
    await page.waitForSelector('.toast');
    await shot('07-editor');
    await page.click('[role=tab]:has-text("Cover letter")');
    await shot('08-cover');
  });
  await step('print view renders for PDF export', async () => {
    await page.goto(`${BASE}/print/${appId}?doc=resume`);
    await page.waitForSelector('.sheet h1');
    await page.pdf({ path: 'test-output/resume.pdf', format: 'A4' });
    ok(fs.statSync('test-output/resume.pdf').size > 5000);
  });
  await step('profile page loads the saved profile with ids kept', async () => {
    await page.goto(`${BASE}/profile`);
    await page.waitForSelector('#b-name');
    eq(await page.inputValue('#b-name'), 'Asha Rao');
    await shot('09-profile');
  });
  await step('settings shows the connector address and tests a source', async () => {
    await page.goto(`${BASE}/settings`);
    await page.waitForSelector('input[aria-label="Connector address"]');
    eq(await page.inputValue('input[aria-label="Connector address"]'), `${BASE}/api/mcp`);
    await page.locator('button:has-text("Test with 3 results")').first().click();
    await page.waitForSelector('pre.json', { timeout: 30000 });
    await shot('10-settings');
  });
  await step('a narrow phone-sized window still works', async () => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`${BASE}/`);
    await page.waitForSelector('.row-job');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    if (overflow) {
      const wide = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 2).slice(0, 6).map((e) => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right)));
      throw new Error('page should not scroll sideways: ' + JSON.stringify(wide));
    }
    await shot('11-mobile');
  });
  await step('no unexpected script errors in the browser', async () => {
    eq(errors, []);
  });
  await browser.close();
}

try {
  await main();
} catch (e) {
  console.error('FATAL', e);
  failures.push('fatal: ' + (e?.message ?? e));
} finally {
  procs.forEach((p) => { try { process.kill(-p.pid, 'SIGTERM'); } catch {} });
}
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('Failed:\n - ' + failures.join('\n - '));
  process.exit(1);
}
process.exit(0);
