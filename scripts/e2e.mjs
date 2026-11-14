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
// The owner account is created on first start with these defaults.
const OWNER = 'sksiva';
const PASSWORD = 'sksiva';
const STATIC_TOKEN = 'static-token-static-token-static-token-1234';
const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: String(PORT),
  AUTH_SECRET: 'test-secret-test-secret-test-secret-test-secret',
  APIFY_TOKEN: 'test-token',
  APIFY_API_BASE: 'http://localhost:4010',
  APIFY_MAX_CHARGE_USD: '2',
  MCP_API_TOKEN: STATIC_TOKEN,
  LOCAL_DB_DIR: '.data/e2e-pglite',
  // Server-side PDF uses an installed Chrome when not on Vercel.
  CHROME_PATH: process.env.E2E_CHROME ?? process.env.CHROME_PATH ?? (() => { try { return require('playwright').chromium.executablePath(); } catch { return ''; } })(),
  MOCK_DELAY_MS: '4000',
};
fs.rmSync('.data/e2e-pglite', { recursive: true, force: true });
fs.mkdirSync('test-output', { recursive: true });

// A database made by the first version of the app (no years columns), to check the upgrade path.
async function seedLegacyDb() {
  const { PGlite } = require('@electric-sql/pglite');
  fs.mkdirSync('.data', { recursive: true });
  const pg = new PGlite('.data/e2e-pglite');
  await pg.exec(`CREATE TABLE kv (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE jobs (id text PRIMARY KEY, dedupe_key text NOT NULL UNIQUE, source text NOT NULL, external_id text, title text NOT NULL,
      company text NOT NULL DEFAULT '', location text NOT NULL DEFAULT '', remote boolean NOT NULL DEFAULT false, url text, apply_url text,
      description text NOT NULL DEFAULT '', posted_at timestamptz, salary text, employment_type text, seniority text,
      tags jsonb NOT NULL DEFAULT '[]'::jsonb, state text NOT NULL DEFAULT 'new', score int, score_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
      score_flags jsonb NOT NULL DEFAULT '[]'::jsonb, first_seen timestamptz NOT NULL DEFAULT now(), last_seen timestamptz NOT NULL DEFAULT now(), notes text NOT NULL DEFAULT '');
    INSERT INTO jobs (id, dedupe_key, source, title, company, description, state)
      VALUES ('j_legacy01', 'manual:legacy', 'manual', 'Legacy Engineer', 'Old Co', 'Build things. We need 4 years of industry experience.', 'dismissed');
    -- A two-role, two-place search made before run-level tracking: jobs are linked to the search but not to the runs that found them.
    CREATE TABLE searches (id text PRIMARY KEY, query jsonb NOT NULL, status text NOT NULL DEFAULT 'running', created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz);
    CREATE TABLE search_runs (id text PRIMARY KEY, search_id text NOT NULL, source text NOT NULL, actor text NOT NULL, apify_run_id text, dataset_id text,
      status text NOT NULL DEFAULT 'running', error text, found int NOT NULL DEFAULT 0, added int NOT NULL DEFAULT 0, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, kw text, loc text);
    CREATE TABLE search_jobs (search_id text NOT NULL, job_id text NOT NULL, PRIMARY KEY (search_id, job_id));
    INSERT INTO searches (id, query, status, created_at) VALUES ('s_legacy', '{"keywords":["ai engineer","applied scientist"],"location":["Bengaluru","Mumbai"],"remote":false,"days":7}', 'done', now() - interval '9 days');
    INSERT INTO search_runs (id, search_id, source, actor, dataset_id, status, kw, loc) VALUES
      ('r_l1', 's_legacy', 'legacy', 'x/y', 'legacy1', 'done', 'ai engineer', 'Bengaluru'),
      ('r_l2', 's_legacy', 'legacy', 'x/y', 'legacy2', 'done', 'applied scientist', 'Mumbai');
    INSERT INTO jobs (id, dedupe_key, source, title, company, state) VALUES
      ('j_old1', 'legacy:3699999001', 'legacy', 'Legacy 3699999001', 'Old Co', 'dismissed'), ('j_old2', 'legacy:3699999002', 'legacy', 'Legacy 3699999002', 'Old Co', 'dismissed'),
      ('j_old3', 'legacy:3699999003', 'legacy', 'Legacy 3699999003', 'Old Co', 'dismissed'), ('j_old4', 'legacy:3699999004', 'legacy', 'Legacy 3699999004', 'Old Co', 'dismissed');
    INSERT INTO search_jobs (search_id, job_id) VALUES ('s_legacy','j_old1'), ('s_legacy','j_old2'), ('s_legacy','j_old3'), ('s_legacy','j_old4');`);
  await pg.close();
}

const procs = [];
await seedLegacyDb();
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
    const r = await fetch(`${BASE}/oauth/authorize`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ ...authParams(), username: OWNER, password: 'nope nope nope', decision: 'allow' }) });
    eq(r.status, 401);
  });
  await step('right password redirects with a code and state', async () => {
    const r = await fetch(`${BASE}/oauth/authorize`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ ...authParams(), username: OWNER, password: PASSWORD, decision: 'allow' }) });
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
    for (const n of ['get_profile', 'update_profile', 'search_jobs', 'get_search', 'list_jobs', 'get_job', 'add_job', 'score_jobs', 'list_searches', 'jobs_to_score', 'set_job_state', 'check_draft', 'save_application', 'list_applications', 'get_application', 'set_application_status'])
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

  let searchId, jobs, search2;
  await step('search_jobs runs both sources and waits for results', async () => {
    const t0 = Date.now();
    const r = await call('search_jobs', { keywords: ['machine learning engineer'], location: ['Bengaluru'], posted_within_days: 7 });
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
    eq(yc.input.roles, ['Engineering'], 'the YC role category follows the search');
  });
  await step('duplicates merged and the title-less item skipped', async () => {
    const r = await call('list_jobs', { state: 'all', source: 'linkedin', limit: 100 });
    eq(r.data.total, 12, 'linkedin should have 12 unique jobs');
  });
  await step('each posting carries the years of experience it asks for', async () => {
    const r = await call('list_jobs', { state: 'all', source: 'linkedin', limit: 100 });
    const count = (label) => r.data.jobs.filter((x) => x.years_asked === label).length;
    eq([count('5+ yrs'), count('2–4 yrs'), count('1+ yrs'), r.data.jobs.filter((x) => !x.years_asked).length], [3, 3, 3, 3]);
  });
  await step('the years filter keeps the right postings', async () => {
    const base = { state: 'all', source: 'linkedin', limit: 100 };
    eq((await call('list_jobs', { ...base, years_max: 3, include_unstated_years: false })).data.total, 6);
    eq((await call('list_jobs', { ...base, years_max: 3 })).data.total, 9);
    eq((await call('list_jobs', { ...base, years_min: 2, years_max: 3, include_unstated_years: false })).data.total, 3);
    eq((await call('list_jobs', { ...base, years_min: 5, include_unstated_years: false })).data.total, 3);
  });
  await step('a database from the first version upgrades and is backfilled', async () => {
    const g = (await call('get_job', { job_id: 'j_legacy01' })).data;
    eq(g.min_years, 4);
  });
  await step('the YC source filtered by keywords locally', async () => {
    const r = await call('list_jobs', { state: 'all', source: 'yc', limit: 100 });
    ok(r.data.total > 0 && r.data.total <= 10, 'yc total ' + r.data.total);
  });
  await step('searching again finds no new rows (dedupe across searches)', async () => {
    const r = await call('search_jobs', { keywords: ['machine learning engineer'], location: ['Bengaluru'], sources: ['linkedin'] });
    eq(r.data.status, 'done');
    eq(r.data.sources[0].new, 0, 'second search should add nothing');
    search2 = r.data.search_id;
  });
  await step('past searches are listed, each with every job it returned (new or already known)', async () => {
    const r = (await call('list_searches')).data.searches;
    ok(r.length >= 2, 'expected two searches');
    const second = r.find((x) => x.search_id === search2);
    eq(second.jobs, 12, 'second search returned the same 12 linkedin jobs');
    eq(second.new_jobs, 0);
    const first = r.find((x) => x.search_id === searchId);
    eq(first.jobs, 17, 'first search: 12 from LinkedIn plus the 5 YC postings that are ML roles (plain "Founding Engineer" is not)');
    eq((await call('list_jobs', { search_id: search2, state: 'all', limit: 100 })).data.total, 12);
    eq((await call('list_jobs', { search_id: searchId, state: 'all', limit: 100 })).data.total, first.jobs);
  });
  let multi;
  await step('a multi-role, multi-place search records which run found each job', async () => {
    const r = await call('search_jobs', { keywords: ['ai engineer', 'applied scientist'], location: ['Bengaluru', 'Mumbai'], sources: ['linkedin'] });
    eq(r.data.status, 'done', JSON.stringify(r.data.sources));
    multi = r.data.search_id;
    eq(r.data.sources.length, 4, 'two roles x two places = four runs');
    const total = (extra) => call('list_jobs', { search_id: multi, state: 'all', limit: 100, ...extra }).then((x) => x.data.total);
    eq(await total({}), 4);
    eq(await total({ search_role: 'ai engineer' }), 3);
    eq(await total({ search_role: 'Applied Scientist' }), 2);
    eq(await total({ search_place: 'Mumbai' }), 1);
    eq(await total({ search_role: 'ai engineer', search_place: 'Mumbai' }), 0, 'no job came from that pair');
    eq(await total({ search_role: 'applied scientist', search_place: 'Mumbai' }), 1);
    const s = (await call('list_searches', { limit: 1 })).data.searches[0];
    eq([s.roles, s.places], [['ai engineer', 'applied scientist'], ['Bengaluru', 'Mumbai']]);
  });
  await step('jobs_to_score finds a past search by the role it was for and returns only that role\'s unscored jobs', async () => {
    const found = (await call('list_searches', { query: 'Applied Scientist' })).data.searches;
    eq(found[0].search_id, multi, 'newest match first');
    ok(found.some((x) => x.search_id === 's_legacy'), 'older matching search is listed too');
    eq(found[0].unscored_jobs, 4);
    const sci = (await call('jobs_to_score', { search: 'Applied Scientist' })).data;
    eq(sci.search.search_id, multi);
    eq(sci.search.only_role, 'applied scientist');
    eq([sci.unscored_in_scope, sci.returned], [2, 2]);
    ok(sci.jobs.every((j) => j.description && j.description.length > 20 && j.score === undefined), 'jobs come with descriptions');
    eq((await call('jobs_to_score', { search: 'AI Engineer' })).data.returned, 3);
    eq((await call('jobs_to_score', { search_id: multi, search_place: 'Mumbai' })).data.returned, 1);
    eq((await call('list_jobs', { search: 'applied scientist', state: 'all' })).data.total, 2);
    eq((await call('jobs_to_score', { search: 'applied scientist', limit: 1, description_chars: 500 })).data.jobs[0].description.length <= 500, true);
    const miss = await call('jobs_to_score', { search: 'quantum basket weaver' });
    ok(miss.isError && /Recent searches/.test(miss.data.error), 'a miss lists recent searches: ' + JSON.stringify(miss.data));
    await call('score_jobs', { scores: [{ job_id: sci.jobs[0].id, score: 42, reasons: ['test'] }] });
    const after = (await call('jobs_to_score', { search: 'Applied Scientist' })).data;
    eq([after.unscored_in_scope, after.returned], [1, 1]);
    eq((await call('jobs_to_score', { search: 'Applied Scientist', include_scored: true })).data.returned, 2);
  });
  await step('experience levels reach LinkedIn as f_E and are shown in the search list', async () => {
    const r = await call('search_jobs', { keywords: ['ml engineer'], sources: ['linkedin'], experience_levels: ['entry', 'associate'] });
    eq(r.data.status, 'done');
    const log = await (await fetch('http://localhost:4010/__log')).json();
    const li = log.filter((l) => l.actor === 'curious_coder/linkedin-jobs-scraper').at(-1);
    eq(new URL(li.input.urls[0]).searchParams.get('f_E'), '2,3');
    const s = (await call('list_searches', { limit: 1 })).data.searches[0];
    eq(s.experience_levels, ['Entry level', 'Associate']);
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
    const bad = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: OWNER, password: 'wrong wrong wrong' }) });
    eq(bad.status, 401);
    const r = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: OWNER, password: PASSWORD }) });
    eq(r.status, 200);
    return r.headers.get('set-cookie').split(';')[0];
  })();
  const web = (path, init = {}) => fetch(BASE + path, { ...init, headers: { cookie, 'content-type': 'application/json', ...(init.headers ?? {}) } });

  console.log('\nFit scoring v2');
  let v2Job;
  const prefsReset = { workAuthorization: '', blockedCompanies: [], salaryFloor: '' };
  await step('update_profile on basics keeps the contact details Claude cannot see', async () => {
    const r = await call('update_profile', { basics: { headline: 'Changed headline' } });
    ok(!r.isError, JSON.stringify(r.data));
    const p = await (await web('/api/profile')).json();
    eq([p.basics.email, p.basics.phone, p.basics.links.length, p.basics.name], ['asha@example.com', '+91 90000 00000', 1, 'Asha Rao']);
    eq(p.basics.headline, 'Changed headline');
    await call('update_profile', { basics: { headline: SAMPLE_PROFILE.basics.headline } });
  });
  await step('preferences are saved and merged field by field', async () => {
    await call('update_profile', { preferences: { workAuthorization: 'India citizen; needs US sponsorship', blockedCompanies: ['Nope Corp'] } });
    await call('update_profile', { preferences: { salaryFloor: 'INR 20 LPA' } });
    const p = await (await web('/api/profile')).json();
    eq([p.preferences.workAuthorization, p.preferences.blockedCompanies, p.preferences.salaryFloor, p.preferences.remoteOk], ['India citizen; needs US sponsorship', ['Nope Corp'], 'INR 20 LPA', true]);
    ok(JSON.stringify((await call('get_profile')).data).includes('needs US sponsorship'), 'Claude can read preferences');
  });
  await step('jobs_to_score hands over the rubric and the years it will score with', async () => {
    const r = (await call('jobs_to_score', { limit: 3 })).data;
    ok(r.how_to_score.includes('assessments'), 'rubric missing');
    eq(r.profile_years, 1.7);
    ok(r.jobs.length > 0 && r.jobs.every((j) => j.score === undefined));
    v2Job = r.jobs[0].id;
  });
  await step('score_jobs computes fit, callback chance and worth from assessments', async () => {
    const s = await call('score_jobs', {
      assessments: [
        { job_id: v2Job, reqs: [{ skill: 'PyTorch', tier: 'core', evidence: 0.9 }, { skill: 'Kubernetes', tier: 'required', evidence: 0.9 }], min_years: 3, edge: 0.6, edge_basis: 'pub-1 ICLR poster', domain: 0.8, role: 0.85, location: 'same_country', reasons: ['Matches LLM work'], flags: ['Wants Kubernetes'] },
        { job_id: 'j_missing', domain: 0.5, role: 0.5 },
      ],
    });
    ok(!s.isError, JSON.stringify(s.data));
    eq(s.data.saved, 1);
    eq(s.data.unknown_job_ids, ['j_missing']);
    const r0 = s.data.results[0];
    ok(r0.fit > 0 && r0.fit <= 100 && r0.win_pct > 0 && r0.worth > 0, JSON.stringify(r0));
    ok(r0.flags.some((f) => /Kubernetes/.test(f)), 'evidence the profile cannot back up should be flagged');
    const g = (await call('get_job', { job_id: v2Job })).data;
    eq([g.score, g.score_detail.v, g.score_detail.reqs[1].evidence, g.stale], [r0.fit, 2, 0.3, false]);
    eq(g.score_detail.inputs.profile_years, 1.7);
    const top = (await call('list_jobs', { sort: 'worth', limit: 1 })).data.jobs[0];
    eq([top.id, top.effort !== undefined, top.win_pct > 0], [v2Job, true, true]);
    eq((await call('score_jobs', {})).isError, true, 'neither format given');
  });
  await step('a referral raises the chance but not the fit', async () => {
    const before = (await call('get_job', { job_id: v2Job })).data;
    const r = await web(`/api/jobs/${v2Job}`, { method: 'PATCH', body: JSON.stringify({ referral: 0.8 }) });
    eq(r.status, 200);
    const after = (await call('get_job', { job_id: v2Job })).data;
    ok(after.score_detail.win_pct > before.score_detail.win_pct * 2, `${before.score_detail.win_pct} -> ${after.score_detail.win_pct}`);
    eq([after.referral, after.score, after.score_detail.stored.referral], [0.8, before.score, 0.8]);
    eq((await web(`/api/jobs/${v2Job}`, { method: 'PATCH', body: JSON.stringify({ referral: 3 }) })).status, 400);
  });
  await step('changing the profile marks earlier scores as stale, and re-scoring clears it', async () => {
    await call('update_profile', { preferences: { salaryFloor: 'INR 40 LPA' } });
    const stale = (await call('list_jobs', { stale_only: true, limit: 100 })).data.jobs.map((j) => j.id);
    ok(stale.includes(v2Job) && stale.includes(jobA), 'both the v2 and the older-format score are stale');
    const toRescore = (await call('jobs_to_score', { stale_only: true, limit: 25 })).data;
    ok(toRescore.jobs.some((j) => j.id === v2Job) && toRescore.stale_in_scope >= 2);
    await call('score_jobs', { assessments: [{ job_id: v2Job, reqs: [{ skill: 'PyTorch', tier: 'core', evidence: 0.9 }], domain: 0.8, role: 0.85 }] });
    ok(!(await call('get_job', { job_id: v2Job })).data.stale, 'fresh after re-scoring');
    eq((await call('get_job', { job_id: v2Job })).data.referral, 0.8, 'referral survives a re-score');
    await call('update_profile', { preferences: prefsReset });
    ok(!(await call('get_job', { job_id: jobA })).data.stale, 'the older-format score is current again once the profile is back');
  });
  await step('failing, missing, rental and slow actors are reported clearly', async () => {
    const cur = (await (await web('/api/sources')).json()).sources;
    const add = (id, actor) => ({ id, label: id, enabled: true, preset: 'custom', actor, input: { q: '{{keywords}}' }, maxResults: 5, localKeywordFilter: false });
    const put = await web('/api/sources', { method: 'PUT', body: JSON.stringify([...cur.map((s) => ({ ...s, enabled: false })), add('failx', 'fail/x'), add('gone', 'missing/x'), add('paid', 'rental/x'), add('slow', 'slow/x')]) });
    eq(put.status, 200);
    const r = await call('search_jobs', { keywords: ['anything'], sources: ['failx', 'gone', 'paid', 'slow'] });
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
  await step('the web API lists past searches and the job ids of one', async () => {
    const list = (await (await web('/api/searches')).json()).searches;
    ok(list.length >= 2 && list.every((x) => typeof x.jobs === 'number'));
    const ids = (await (await web(`/api/searches/${search2}/jobs`)).json()).ids;
    eq(ids.length, 12);
  });
  await step('a multi-role search made before run tracking gets its roles and places rebuilt from Apify', async () => {
    const m = await (await web('/api/searches/s_legacy/jobs')).json();
    eq([m.roles, m.places], [['ai engineer', 'applied scientist'], ['Bengaluru', 'Mumbai']]);
    const by = (ri, pi) => m.rows.filter((r) => r[1] === ri && r[2] === pi).length;
    eq([by(0, 0), by(1, 1), by(0, 1), by(1, 0)], [3, 1, 0, 0]);
    const again = await (await web('/api/searches/s_legacy/jobs')).json();
    eq(again.rows.length, 4, 'a second look changes nothing');
    eq((await call('list_jobs', { search_id: 's_legacy', search_role: 'applied scientist', state: 'all' })).data.total, 1);
  });
  await step('the scope endpoint returns role and place attribution only when there is something to filter', async () => {
    const m = await (await web(`/api/searches/${multi}/jobs`)).json();
    eq([m.roles, m.places], [['ai engineer', 'applied scientist'], ['Bengaluru', 'Mumbai']]);
    ok(m.rows.length >= 5, 'rows ' + m.rows.length);
    const single = await (await web(`/api/searches/${search2}/jobs`)).json();
    eq([single.roles, single.places, single.rows.length], [[], [], 0]);
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

  console.log('\nAccounts');
  const jsonPost = (path, body, ck, method = 'POST') =>
    fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(ck ? { cookie: ck } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const cookieOf = (r) => (r.headers.get('set-cookie') ?? '').split(';')[0];
  const ownerJobs = (await (await web('/api/jobs')).json()).total;
  const ownerSearches = (await (await web('/api/searches')).json()).searches.length;
  const ownerSearchId = (await (await web('/api/searches')).json()).searches[0].id;
  let aliceCookie, aliceId;
  await step('sign-up checks the username and password, and usernames are case-insensitive', async () => {
    eq((await jsonPost('/api/signup', { username: 'al', password: 'longenough1' })).status, 400, 'short username');
    eq((await jsonPost('/api/signup', { username: 'alice!', password: 'longenough1' })).status, 400, 'odd characters');
    eq((await jsonPost('/api/signup', { username: 'alice', password: 'short' })).status, 400, 'short password');
    eq((await jsonPost('/api/signup', { username: 'SKSIVA', password: 'longenough1' })).status, 409, 'taken, ignoring case');
    const r = await jsonPost('/api/signup', { username: 'Alice', password: 'alice-password-1' });
    eq(r.status, 200, await r.clone().text());
    aliceCookie = cookieOf(r);
    ok(aliceCookie.startsWith('jh_session='));
    eq((await jsonPost('/api/signup', { username: 'alice', password: 'another-password' })).status, 409);
    const me = await (await fetch(BASE + '/api/me', { headers: { cookie: aliceCookie } })).json();
    eq([me.username, me.isOwner, me.apify.source], ['alice', false, 'none']);
    aliceId = me.username;
  });
  await step('a new person starts with nothing: no jobs, searches, profile or applications', async () => {
    const a = (p, init = {}) => fetch(BASE + p, { ...init, headers: { cookie: aliceCookie, 'content-type': 'application/json' } });
    eq((await (await a('/api/jobs')).json()).total, 0);
    eq((await (await a('/api/searches')).json()).searches, []);
    eq((await (await a('/api/applications')).json()).applications, []);
    const prof = await (await a('/api/profile')).json();
    eq([prof.basics.name, prof.experience.length], ['', 0]);
    const src = await (await a('/api/sources')).json();
    eq(src.sources.map((s) => [s.id, s.enabled]), [['linkedin', true], ['yc', true]], 'default sources, not the owner\'s edited ones');
  });
  await step('she cannot read or change the owner\'s data by guessing ids', async () => {
    const a = (p, init = {}) => fetch(BASE + p, { ...init, headers: { cookie: aliceCookie, 'content-type': 'application/json' } });
    eq((await a('/api/jobs/' + jobA)).status, 404);
    eq((await a('/api/applications/' + appId)).status, 404);
    eq((await a(`/api/applications/${appId}/docx`)).status, 404);
    eq((await a('/api/searches/' + ownerSearchId)).status, 404);
    eq((await a(`/api/searches/${ownerSearchId}/jobs`)).status, 404);
    eq((await a('/api/searches/s_legacy/jobs')).status, 404);
    await a('/api/jobs/' + jobA, { method: 'PATCH', body: '{"state":"dismissed","notes":"hacked"}' });
    const mine = await (await web('/api/jobs/' + jobA)).json();
    ok(mine.state !== 'dismissed' && mine.notes !== 'hacked', 'owner\'s job must be unchanged');
    eq((await a(`/api/applications/${appId}`, { method: 'DELETE' })).status, 404);
    eq((await (await web(`/api/applications/${appId}`)).json()).id, appId, 'owner\'s application still exists');
    const pr = await a(`/print/${appId}`);
    eq(pr.status, 404, 'print view of someone else\'s application');
  });
  await step('searching needs her own Apify token; with one, runs use it and stay in her account', async () => {
    const a = (p, init = {}) => fetch(BASE + p, { ...init, headers: { cookie: aliceCookie, 'content-type': 'application/json' } });
    const body = JSON.stringify({ keywords: ['machine learning engineer'], location: ['Bengaluru'], sources: ['linkedin'] });
    const no = await a('/api/searches', { method: 'POST', body });
    eq(no.status, 400);
    ok(/Apify API token/.test((await no.json()).error));
    eq((await a('/api/account/apify', { method: 'PUT', body: '{"token":"short"}' })).status, 400);
    const put = await (await a('/api/account/apify', { method: 'PUT', body: '{"token":"alice-token"}' })).json();
    eq([put.apify.source, put.apify.last4], ['own', 'oken']);
    ok(!JSON.stringify(put).includes('alice-token'), 'the token must never be sent back');
    const start = await (await a('/api/searches', { method: 'POST', body })).json();
    let sv = start;
    for (let i = 0; i < 40 && sv.status === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      sv = await (await a('/api/searches/' + start.id)).json();
    }
    eq(sv.status, 'done', JSON.stringify(sv.runs));
    ok(sv.jobs > 0, 'she got listings');
    const log = await (await fetch('http://localhost:4010/__log')).json();
    eq(log.at(-1).token, 'alice-token', 'the run used her token, not the server\'s');
    eq(log.filter((l) => l.token === 'alice-token').length, 1);
    eq((await (await a('/api/searches')).json()).searches.length, 1);
    eq((await (await web('/api/searches')).json()).searches.length, ownerSearches, 'owner\'s search list unchanged');
    eq((await (await web('/api/jobs')).json()).total, ownerJobs, 'the same listings are stored separately, not added to the owner\'s');
    eq((await a(`/api/searches/${start.id}/jobs`)).status, 200);
    eq((await web(`/api/searches/${start.id}/jobs`)).status, 404, 'and the owner cannot open her search');
  });
  await step('her profile and sources are separate', async () => {
    const a = (p, init = {}) => fetch(BASE + p, { ...init, headers: { cookie: aliceCookie, 'content-type': 'application/json' } });
    await a('/api/profile', { method: 'PUT', body: JSON.stringify({ basics: { name: 'Alice Example', headline: 'Tester' }, skills: ['Testing'] }) });
    eq((await (await a('/api/profile')).json()).basics.name, 'Alice Example');
    const own = await (await web('/api/profile')).json();
    ok(own.basics.name !== 'Alice Example', 'owner profile unchanged');
  });

  // Claude connector as Alice
  let aliceAccess, aliceClient, alice;
  await step('the Claude connector asks for a username, and signs her in as herself', async () => {
    const page = await (await fetch(`${BASE}/oauth/authorize?${new URLSearchParams(authParams())}`)).text();
    ok(page.includes('name="username"') && page.includes('name="password"'), 'authorize form has both fields');
    const bad = await fetch(`${BASE}/oauth/authorize`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ ...authParams(), username: 'alice', password: PASSWORD, decision: 'allow' }) });
    eq(bad.status, 401, 'owner password does not open alice');
    const ok1 = await fetch(`${BASE}/oauth/authorize`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ ...authParams(), username: 'ALICE', password: 'alice-password-1', decision: 'allow' }) });
    eq(ok1.status, 302);
    const code2 = new URL(ok1.headers.get('location')).searchParams.get('code');
    const t = await (await tokenReq({ grant_type: 'authorization_code', code: code2, redirect_uri: REDIRECT, code_verifier: verifier, resource: `${BASE}/api/mcp` })).json();
    aliceAccess = t.access_token;
    aliceClient = new Client({ name: 'e2e-alice', version: '1.0.0' });
    await aliceClient.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), { requestInit: { headers: { Authorization: `Bearer ${aliceAccess}` } } }));
    alice = async (name, args = {}) => {
      const r = await aliceClient.callTool({ name, arguments: args });
      let data;
      try { data = JSON.parse(r.content?.[0]?.text ?? '{}'); } catch { data = {}; }
      return { isError: !!r.isError, data };
    };
    eq((await alice('get_profile')).data.profile?.basics?.name ?? (await alice('get_profile')).data.basics?.name, 'Alice Example');
  });
  await step('through Claude she sees only her jobs and searches, and cannot score or read the owner\'s', async () => {
    const mine = (await alice('list_jobs', { state: 'all', limit: 100 })).data;
    ok(mine.total > 0 && mine.total < ownerJobs + 1, 'her own listings');
    ok(!mine.jobs.some((j) => j.id === jobA), 'owner job not in her list');
    eq((await alice('list_searches')).data.searches.length, 1);
    eq((await alice('get_job', { job_id: jobA })).isError, true);
    const sc = (await alice('score_jobs', { scores: [{ job_id: jobA, score: 1, reasons: ['x'] }] })).data;
    eq(sc.saved, 0);
    eq(sc.unknown_job_ids, [jobA]);
    eq((await call('get_job', { job_id: jobA })).data.score, 91, 'owner\'s score untouched');
    eq((await alice('set_job_state', { job_ids: [jobA], state: 'dismissed' })).data.updated, 0);
    eq((await alice('list_applications')).data.applications.length, 0);
    eq((await alice('get_application', { application_id: appId })).isError, true);
    const draft = await alice('save_application', { job_id: jobA, resume: { experience: [], projects: [], education: [], achievements: [], publications: [], skills: [] }, cover_letter: 'x', gaps: [] });
    eq(draft.isError, true, 'cannot draft against someone else\'s job');
    const mineScored = (await alice('jobs_to_score', { limit: 3 })).data;
    ok(mineScored.jobs.length > 0 && mineScored.jobs.every((j) => j.id !== jobA));
    eq((await alice('jobs_to_score', { search: 'applied scientist' })).isError, true, 'owner\'s search is not findable by her');
    const s = await alice('search_jobs', { keywords: ['x engineer'], sources: ['linkedin'] });
    eq(s.isError, false, 'she has a token, so she can search');
  });
  await step('changing a password ends other sessions and Claude connections', async () => {
    const a = (p, init = {}) => fetch(BASE + p, { ...init, headers: { cookie: aliceCookie, 'content-type': 'application/json' } });
    eq((await a('/api/account/password', { method: 'POST', body: JSON.stringify({ current: 'wrong-current', next: 'new-alice-password' }) })).status, 400);
    eq((await a('/api/account/password', { method: 'POST', body: JSON.stringify({ current: 'alice-password-1', next: 'tiny' }) })).status, 400);
    const r = await a('/api/account/password', { method: 'POST', body: JSON.stringify({ current: 'alice-password-1', next: 'new-alice-password' }) });
    eq(r.status, 200);
    const fresh = cookieOf(r);
    eq((await fetch(BASE + '/api/me', { headers: { cookie: aliceCookie } })).status, 401, 'old session dead');
    eq((await fetch(BASE + '/api/me', { headers: { cookie: fresh } })).status, 200, 'this session kept');
    aliceCookie = fresh;
    const mcp = await fetch(`${BASE}/api/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${aliceAccess}` }, body: '{}' });
    eq(mcp.status, 401, 'old Claude token dead');
    eq((await jsonPost('/api/login', { username: 'alice', password: 'alice-password-1' })).status, 401);
    eq((await jsonPost('/api/login', { username: 'alice', password: 'new-alice-password' })).status, 200);
    await aliceClient.close().catch(() => {});
  });
  await step('only the owner sees the People list; it shows counts, and the owner can reset or delete', async () => {
    const a = (p, init = {}) => fetch(BASE + p, { ...init, headers: { cookie: aliceCookie, 'content-type': 'application/json' } });
    eq((await a('/api/admin/users')).status, 403);
    const list = (await (await web('/api/admin/users')).json()).users;
    eq(list.map((u) => [u.username, u.isOwner]), [['sksiva', true], ['alice', false]]);
    const al = list.find((u) => u.username === 'alice');
    ok(al.jobs > 0 && al.searches >= 1, 'counts only');
    ok(!JSON.stringify(list).includes('password') && !JSON.stringify(list).includes('Alice Example'), 'no secrets or content in the list');
    eq((await a(`/api/admin/users/${al.id}`, { method: 'PATCH', body: '{"password":"hijack-attempt-1"}' })).status, 403);
    eq((await web(`/api/admin/users/${al.id}`, { method: 'PATCH', body: '{"password":"short"}' })).status, 400);
    eq((await web(`/api/admin/users/${al.id}`, { method: 'PATCH', body: '{"password":"owner-set-password"}' })).status, 200);
    eq((await fetch(BASE + '/api/me', { headers: { cookie: aliceCookie } })).status, 401, 'her session ended by the reset');
    eq((await jsonPost('/api/login', { username: 'alice', password: 'new-alice-password' })).status, 401);
    const back = await jsonPost('/api/login', { username: 'alice', password: 'owner-set-password' });
    eq(back.status, 200);
    const owner = list.find((u) => u.isOwner);
    eq((await web(`/api/admin/users/${owner.id}`, { method: 'DELETE' })).status, 400, 'cannot delete yourself');
    eq((await web(`/api/admin/users/${al.id}`, { method: 'DELETE' })).status, 200);
    eq((await jsonPost('/api/login', { username: 'alice', password: 'owner-set-password' })).status, 401);
    eq((await fetch(BASE + '/api/me', { headers: { cookie: cookieOf(back) } })).status, 401, 'deleted account has no session');
    eq((await (await web('/api/admin/users')).json()).users.length, 1);
    eq((await (await web('/api/jobs')).json()).total, ownerJobs, 'owner data untouched by the deletion');
    // her name is free again
    eq((await jsonPost('/api/signup', { username: 'alice', password: 'fresh-alice-pass' })).status, 200);
    const fresh = await fetch(BASE + '/api/jobs', { headers: { cookie: cookieOf(await jsonPost('/api/login', { username: 'alice', password: 'fresh-alice-pass' })) } });
    eq((await fresh.json()).total, 0, 'a new alice does not inherit the old alice\'s data');
  });
  await step('repeated wrong passwords are locked out', async () => {
    let last;
    for (let i = 0; i < 9; i++) last = await jsonPost('/api/login', { username: 'ghost', password: 'wrong-password-' + i });
    eq(last.status, 429);
    eq((await jsonPost('/api/login', { username: 'sksiva', password: PASSWORD })).status, 200, 'other accounts are unaffected');
  });
  void aliceId;

  console.log('\nAny profession');
  await step('the target role is inferred until Claude sets it', async () => {
    const p = (await call('get_profile')).data;
    eq(p.target_in_use.source, 'inferred');
    ok(p.target_in_use.function && /update_profile/.test(p.target_todo), JSON.stringify(p.target_in_use));
    await call('update_profile', { target: { function: 'Machine learning engineering', alsoCalled: ['Applied Scientist'] } });
    const p2 = (await call('get_profile')).data;
    eq([p2.target_in_use.source, p2.target_in_use.function, p2.target_todo], ['profile', 'Machine learning engineering', undefined]);
    ok(p2.basics.name === p.basics.name && p2.experience.length === p.experience.length, 'setting the target leaves the rest alone');
  });
  await step('a search outside engineering asks YC for every category, not engineering', async () => {
    const r = await fetch(BASE + '/api/sources/test', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ source: (await (await fetch(BASE + '/api/sources', { headers: { cookie } })).json()).sources.find((x) => x.id === 'yc'), keywords: 'product manager', location: '' }) });
    eq(r.status, 200);
    const log = await (await fetch('http://localhost:4010/__log')).json();
    const yc = log.filter((l) => l.actor === 'tqm/ycombinator-scraper').pop();
    eq(yc.input.roles, []);
  });
  await step('roles the user avoids are hidden from lists and never offered for scoring', async () => {
    const before = (await call('list_jobs', { state: 'all', limit: 100 })).data.total;
    await call('update_profile', { preferences: { avoidRoles: ['founding ml engineer'] } });
    const after = (await call('list_jobs', { state: 'all', limit: 100 })).data.total;
    eq(before - after, 5, 'the five Founding ML Engineer postings');
    eq((await call('list_jobs', { state: 'all', limit: 100, include_hidden: true })).data.total, before);
    const s = (await call('jobs_to_score', { include_scored: true, state: 'all', limit: 25 })).data;
    ok(s.jobs.length > 0 && s.jobs.every((j) => !/founding ml engineer/i.test(j.title)));
    ok(s.experience_ids.length > 0 && s.target.function === 'Machine learning engineering');
    await call('update_profile', { preferences: { avoidRoles: [] } });
    eq((await call('list_jobs', { state: 'all', limit: 100 })).data.total, before);
  });
  await step('scoring counts only the experience that is relevant to the job', async () => {
    const p = (await call('get_profile')).data;
    const a = { job_id: jobs[0].id, reqs: [{ skill: 'Python', kind: 'tool', tier: 'core', evidence: 0.7 }, { skill: 'Mentoring', kind: 'soft', tier: 'required', evidence: 0.9, basis: 'exp-99' }], min_years: 3, domain: 0.8, role: 0.8, location: 'match' };
    const r1 = (await call('score_jobs', { assessments: [a] })).data.results[0];
    const r2 = (await call('score_jobs', { assessments: [{ ...a, relevant_experience: [p.experience[1].id] }] })).data.results[0];
    ok(r2.fit < r1.fit, `${r2.fit} should be below ${r1.fit}`);
    ok(r2.flags.some((f) => /years are in this kind of work/.test(f)) && r1.flags.some((f) => /Mentoring/.test(f)), JSON.stringify([r1.flags, r2.flags]));
  });
  await step('LinkedIn messages are saved on the job, checked and merged', async () => {
    const jid = jobs[0].id;
    const r = (await call('save_outreach', { job_id: jid, connect_note: 'x'.repeat(250), message: 'I hope this finds you well. I grew revenue 45% at Initech.' })).data;
    const issues = r.warnings.map((w) => w.issue).join(' | ');
    ok(r.saved && /free LinkedIn account/.test(issues) && /Pleasantry/.test(issues) && /no ask/.test(issues) && /not in your profile/.test(issues), issues);
    const r2 = (await call('save_outreach', { job_id: jid, connect_note: 'Hi [Name], I am an AI engineer at Fabrikam Research and applied for this role. Glad to connect.', message: '' })).data;
    eq(r2.warnings, [], 'a clean note has no warnings');
    const g = (await call('get_job', { job_id: jid })).data;
    eq([g.outreach.message, g.outreach.connect_note.startsWith('Hi [Name]')], ['', true]);
    const web = await fetch(`${BASE}/api/jobs/${jid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ outreach: { referral_ask: 'Would you be open to referring me?' } }) });
    const saved = (await web.json()).outreach;
    eq([saved.referral_ask, saved.connect_note.startsWith('Hi [Name]'), saved.checks.length], ['Would you be open to referring me?', true, 0]);
    ok((await call('save_outreach', { job_id: jid })).isError, 'nothing to save is an error');
  });
  await step('LinkedIn messages alone still get a place under Applications, later filled by the resume', async () => {
    const job = jobs[6];
    eq((await call('get_job', { job_id: job.id })).data.applications.length, 0, 'this job starts with no application');
    const r = (await call('save_outreach', { job_id: job.id, message: 'Hi [Name], I applied for this role. Are you the right person to ask about it?' })).data;
    ok(r.application_id && r.review_at.endsWith(`/applications/${r.application_id}?doc=linkedin`), JSON.stringify(r));
    const row = (await call('list_applications')).data.applications.find((a) => a.id === r.application_id);
    eq([row.has_resume, row.has_cover, row.has_linkedin, row.status], [false, false, true, 'draft']);
    const web = await (await fetch(`${BASE}/api/applications/${r.application_id}`, { headers: { cookie } })).json();
    eq([web.resume.experience, web.resume.skills, web.has_linkedin], [[], [], true], 'an empty resume reads as empty lists');
    eq((await fetch(`${BASE}/api/applications/${r.application_id}/docx?doc=resume`, { headers: { cookie } })).status, 200);
    const again = (await call('save_outreach', { job_id: job.id, connect_note: 'Hi [Name], I applied for this role. Glad to connect.' })).data;
    eq(again.application_id, r.application_id, 'no second application for the same job');
    const p = (await call('get_profile')).data;
    const d = (await call('save_application', { job_id: job.id, experience: [{ profile_id: p.experience[0].id }], cover_letter: 'Dear team,\n\nI would like to apply.\n\nAsha' })).data;
    eq([d.application_id, d.updated_existing_draft], [r.application_id, true], 'the resume fills the same application');
    const filled = (await call('list_applications')).data.applications.find((a) => a.id === r.application_id);
    eq([filled.has_resume, filled.has_cover, filled.has_linkedin], [true, true, true]);
  });
  await step('a draft can order and rename resume sections and carry LinkedIn messages', async () => {
    const p = (await call('get_profile')).data;
    const r = (await call('save_application', {
      job_id: jobs[2].id,
      experience: [{ profile_id: p.experience[0].id }],
      sections: [{ key: 'experience' }, { key: 'achievements', title: 'Certifications & Awards' }],
      cover_letter: 'Dear team,\n\nI would like to apply.\n\nAsha',
      linkedin: { message: 'Hi [Name], I applied for this role. Are you the right person to ask about it?' },
    })).data;
    ok(r.application_id && r.linkedin_saved, JSON.stringify(r));
    const a = (await call('get_application', { application_id: r.application_id })).data;
    eq(a.resume.layout.slice(0, 2).map((x) => x.title), ['Experience', 'Certifications & Awards']);
    eq(a.resume.layout.length, 7);
    eq((await fetch(`${BASE}/api/applications/${r.application_id}/docx?doc=resume`, { headers: { cookie } })).status, 200);
    eq((await call('get_job', { job_id: jobs[2].id })).data.outreach.message.startsWith('Hi [Name]'), true);
  });

  await client.close();

  if (process.env.E2E_SKIP_BROWSER) console.log('\nBrowser tests skipped (E2E_SKIP_BROWSER)');
  else {
    console.log('\nBrowser');
    await browserTests(cookie, appId);
  }
}

async function browserTests(cookie, appId) {
  const { chromium } = require('playwright');
  // E2E_CHROME=/path/to/chrome uses an installed browser instead of the one Playwright downloads.
  const browser = await chromium.launch(process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {});
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
    await page.click('[role=tab]:nth-child(2)');
    await page.waitForSelector('#pw2');
    await shot('01b-signup');
    await page.setViewportSize({ width: 390, height: 800 });
    await shot('01c-signup-mobile');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.click('[role=tab]:nth-child(1)');
    ok(await page.locator('text=Contact SK to change it').count(), 'login page should say who to contact about passwords');
    await page.fill('#un', OWNER);
    await page.fill('#pw', 'wrong password here');
    await page.click('form button.primary');
    await page.waitForSelector('[role=alert]');
    await page.fill('#pw', PASSWORD);
    await page.click('button[type=submit], form button.primary');
    await page.waitForURL(`${BASE}/`);
  });
  await step('the guide is public and its interactive parts work', async () => {
    const g = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const gp = await g.newPage();
    const gerrs = [];
    gp.on('pageerror', (e) => gerrs.push(e.message));
    await gp.goto(`${BASE}/guide`);
    ok(gp.url().endsWith('/guide'), 'guide must not redirect when signed out');
    await gp.waitForSelector('.g-step');
    eq(await gp.locator('.g-count').innerText(), '0 of 5 done');
    await gp.locator('.g-step-toggle', { hasText: 'Connect Claude' }).click();
    eq(await gp.inputValue('input[aria-label="Connector address"]'), `${BASE}/api/mcp`);
    await gp.locator('.g-step.is-open button', { hasText: 'Mark as done' }).click();
    await gp.waitForFunction(() => document.querySelector('.g-count')?.textContent?.startsWith('1 of 5'));
    await gp.reload();
    await gp.waitForFunction(() => document.querySelector('.g-count')?.textContent?.startsWith('1 of 5'));
    await gp.locator('.g-step-toggle', { hasText: 'Create your account' }).scrollIntoViewIfNeeded();
    await gp.screenshot({ path: 'test-output/12a-guide-top.png' });
    await gp.locator('#try').scrollIntoViewIfNeeded();
    await gp.click('.g-compose .btn.primary');
    await gp.waitForSelector('.g-tools li.ok', { timeout: 10000 });
    await gp.waitForSelector('.g-profile .g-chip', { timeout: 15000 });
    await gp.waitForFunction(() => document.querySelector('.g-compose .btn.primary')?.textContent === 'Play again', null, { timeout: 15000 });
    await gp.screenshot({ path: 'test-output/12b-guide-demo-resume.png' });
    await gp.locator('.chip', { hasText: 'Score the results' }).click();
    await gp.click('.g-compose .btn.primary');
    await gp.waitForSelector('.g-score', { timeout: 20000 });
    const scores = (await gp.locator('.g-score').allInnerTexts()).map(Number);
    eq(scores, [...scores].sort((a, b) => b - a), 'demo jobs are sorted by score');
    await gp.locator('.g-job', { hasText: 'Brightloom' }).click();
    ok(await gp.locator('.g-why', { hasText: 'ranking models' }).count(), 'clicking a job shows why');
    await gp.screenshot({ path: 'test-output/12c-guide-demo-score.png' });
    await gp.locator('.chip', { hasText: 'Draft an application' }).click();
    await gp.click('.g-compose .btn.primary');
    await gp.waitForSelector('.g-sheet', { timeout: 20000 });
    await gp.locator('[role=tab]', { hasText: 'Gaps Claude found' }).click();
    ok(await gp.locator('.g-sheet', { hasText: 'Kubernetes' }).count());
    await gp.locator('.chip', { hasText: 'Track progress' }).click();
    await gp.click('.g-compose .btn.primary');
    await gp.waitForSelector('.g-board', { timeout: 20000 });
    await gp.waitForFunction(() => document.querySelector('.g-col:nth-child(2) .g-kcard'));
    await gp.locator('.g-kcard', { hasText: 'Brightloom' }).locator('button[aria-label*="forward"]').click();
    await gp.waitForFunction(() => document.querySelectorAll('.g-col:nth-child(2) .g-kcard').length === 2);
    await gp.locator('#prompts .chip', { hasText: 'Score' }).click();
    eq(await gp.locator('.g-pcard').count(), 3);
    await gp.locator('#help summary').first().click();
    await gp.locator('#prompts').scrollIntoViewIfNeeded();
    await gp.screenshot({ path: 'test-output/12d-guide-prompts.png' });
    await gp.setViewportSize({ width: 390, height: 800 });
    await gp.locator('#try').scrollIntoViewIfNeeded();
    await gp.screenshot({ path: 'test-output/12e-guide-mobile.png' });
    eq(await gp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scrolling on a phone');
    eq(gerrs, [], 'no script errors on the guide');
    await g.close();
  });
  await step('the Jobs page opens on the latest search and lists past searches', async () => {
    await page.waitForFunction(() => document.querySelectorAll('.past-item').length >= 4 && document.querySelector('.scope h1')?.textContent !== 'All jobs');
    ok((await page.locator('.past-item').count()) >= 4, 'All jobs plus the searches');
    eq(await page.locator('.past-item[aria-current=true]').count(), 1);
    ok(/ml engineer/i.test(await page.locator('.scope').innerText()), 'banner should name the search: ' + (await page.locator('.scope').innerText()));
    ok((await page.locator('.scope').innerText()).includes('Entry level'), 'banner should show the level');
    await shot('02a-scope');
  });
  await step('picking a past search shows only its listings; All jobs shows everything', async () => {
    const allCount = async () => {
      await page.waitForFunction(() => [...document.querySelectorAll('.tabs button')].find((b) => b.textContent.startsWith('All'))?.querySelector('.n')?.textContent !== '0');
      return Number(await page.locator('.tabs button:has-text("All") .n').innerText());
    };
    await page.locator('.past-item', { hasText: 'All jobs' }).click();
    await page.waitForFunction(() => document.querySelector('.scope h1')?.textContent === 'All jobs');
    const everything = await allCount();
    await page.locator('.past-item', { hasText: /^machine learning engineer/ }).first().click();
    await page.waitForSelector('.scope h1');
    const one = await allCount();
    ok(one > 0 && one < everything, `search ${one} vs all ${everything}`);
    await page.locator('.scope .btn', { hasText: 'Show all jobs' }).click();
    await page.waitForFunction(() => document.querySelector('.scope h1')?.textContent === 'All jobs');
    eq(await allCount(), everything);
    await page.locator('.past-item', { hasText: /^ml engineer/ }).first().click();
    await page.waitForSelector('.scope h1');
    ok((await page.locator('.past-item', { hasText: 'anything' }).count()) === 1, 'the empty failed search is listed too');
    await page.locator('.past-item', { hasText: 'anything' }).click();
    await page.waitForSelector('text=This search returned no listings');
    await page.locator('.past-item', { hasText: /^ml engineer/ }).first().click();
    await page.waitForSelector('.row-job');
  });
  await step('inside a multi-role search the role and place chips filter the results', async () => {
    await page.locator('.past-item', { hasText: /^ai engineer/ }).first().click();
    await page.waitForSelector('.scope h1');
    await page.click('.tabs button:has-text("All")');
    const rows = async () => page.locator('.row-job').count();
    const chip = (group, text) => page.locator(`[aria-label="${group}"] .chip`, { hasText: text });
    eq(await rows(), 4);
    await page.click('.filters-btn');
    eq((await chip('Role searched', 'ai engineer').innerText()).replace(/\s+/g, ' '), 'ai engineer 3');
    eq((await chip('Role searched', 'applied scientist').innerText()).replace(/\s+/g, ' '), 'applied scientist 2');
    eq((await chip('Place searched', 'Mumbai').innerText()).replace(/\s+/g, ' '), 'Mumbai 1');
    await chip('Role searched', 'ai engineer').click();
    eq(await rows(), 3);
    await chip('Place searched', 'Mumbai').click();
    eq(await rows(), 0, 'no job from the ai engineer + Mumbai run');
    await chip('Role searched', 'ai engineer').click();
    await chip('Role searched', 'applied scientist').click();
    eq(await rows(), 1);
    await shot('02b-role-place-filter');
    ok((await page.locator('.active-chips .tag').count()) === 2, 'active filter chips should be listed');
    await page.click('.fpop-foot button:has-text("Clear filters")');
    eq(await rows(), 4);
    ok((await page.locator('[aria-label="Role searched"]').count()) === 1);
    await page.keyboard.press('Escape');
    await page.locator('.filters-btn[aria-expanded=true]').count() && await page.click('.filters-btn');
    await page.locator('.past-item', { hasText: /^machine learning engineer/ }).first().click();
    await page.waitForSelector('.scope h1');
    await page.click('.filters-btn');
    eq(await page.locator('[aria-label="Role searched"]').count(), 0, 'single-role searches have nothing to split by');
    await page.click('.filters-btn');
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
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.click('.filters-btn');
    await page.waitForTimeout(300);
    await shot('04b-dark-filters');
    await page.click('.filters-btn');
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await page.selectOption('select[aria-label="Sort"]', 'newest');
  });
  await step('searching from the page shows progress, then new rows', async () => {
    await page.click('button:has-text("New search")');
    await page.fill('#kw', 'nlp engineer'); await page.press('#kw', 'Enter');
    await page.fill('#loc', 'Hyderabad'); await page.press('#loc', 'Enter');
    await page.click('.chip:has-text("Entry level")');
    await page.click('button:has-text("Run search")');
    await page.waitForSelector('.runs li');
    await shot('05-searching');
    await page.waitForSelector('.runs .st.done', { timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('.scope h1')?.textContent === 'nlp engineer', null, { timeout: 15000 });
    const log = await (await fetch('http://localhost:4010/__log')).json();
    const li = log.filter((l) => l.actor === 'curious_coder/linkedin-jobs-scraper').at(-1);
    eq(new URL(li.input.urls[0]).searchParams.get('f_E'), '2', 'entry chip should send f_E=2');
    ok((await page.locator('.past-item').first().innerText()).includes('nlp engineer') === false, 'All jobs is first');
    await shot('05b-new-search-scope');
  });
  await step('the years filter narrows the list and rows show what each posting asks', async () => {
    await page.locator('.past-item', { hasText: 'All jobs' }).click();
    await page.waitForFunction(() => document.querySelector('.scope h1')?.textContent === 'All jobs');
    await page.click('.tabs button:has-text("All")');
    const before = await page.locator('.row-job').count();
    await page.click('.filters-btn');
    await page.click('.chip:has-text("Entry 0–2")');
    const after = await page.locator('.row-job').count();
    ok(after > 0 && after < before, `years filter ${before} -> ${after}`);
    await page.uncheck('text=Keep postings that don');
    const rows = await page.locator('.row-job .rj-meta').allInnerTexts();
    ok(rows.length > 0 && rows.every((t) => /yrs|No experience/.test(t)), 'every row should state years: ' + JSON.stringify(rows.slice(0, 3)));
    ok(!rows.some((t) => t.includes('5+ yrs')), 'no 5+ postings');
    await shot('05c-years');
    await page.click('.fpop-foot button:has-text("Clear filters")');
    await page.click('.fpop-foot button.primary');
  });
  await step('the applications board shows the draft and drag changes status', async () => {
    await page.goto(`${BASE}/applications`);
    await page.waitForSelector('.item');
    await shot('06-board');
    const item = page.locator('.item').first();
    await item.dragTo(page.locator('.col', { hasText: 'Interview' }));
    await page.waitForFunction(() => document.querySelector('.col:nth-child(3) .item'));
    ok((await page.locator('.item a.piece', { hasText: 'LinkedIn' }).count()) >= 1, 'a card links straight to its LinkedIn messages');
  });
  await step('the editor renders the resume sheet and edits a bullet', async () => {
    await page.goto(`${BASE}/applications/${appId}`);
    await page.waitForSelector('.piece-box');
    eq(await page.locator('.piece-box').count(), 3, 'resume, cover letter and LinkedIn message each get a box');
    await shot('07a-drafts');
    await page.locator('.piece-box', { hasText: 'LinkedIn message' }).locator('.piece-open').click();
    await page.waitForSelector('.outreach textarea');
    await page.click('button:has-text("All drafts for this job")');
    await page.locator('.piece-box', { hasText: 'Resume' }).locator('.piece-open').click();
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
  // The page rule: a document comes out as 1 page, or 2 with the second one filled, on either paper.
  // Anything else is said on screen instead of being printed as it falls. Shapes, not one person's resume.
  const pdfPages = (file) => (fs.readFileSync(file, 'latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
  const patchApp = (body) => fetch(`${BASE}/api/applications/${appId}`, { method: 'PATCH', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const original = await (await fetch(`${BASE}/api/applications/${appId}`, { headers: { cookie } })).json();
  const sentence = 'Coordinated the weekly handover between **three teams**, cut repeat requests by 18% and wrote the checklist that new starters now follow from their first day';
  const shaped = (jobs, bullets, extras) => ({
    ...original.resume,
    summary: 'Twelve years across operations, people management and customer support, most recently running a regional service desk.',
    experience: Array.from({ length: jobs }, (_, i) => ({ title: `Role ${i + 1}`, company: `Employer ${i + 1}`, location: 'Pune', start: `20${10 + i}`, end: `20${11 + i}`, bullets: Array.from({ length: bullets }, (_, k) => `${sentence} (${i + 1}.${k + 1}).`) })),
    projects: [],
    achievements: Array.from({ length: extras }, (_, k) => `Award ${k + 1} for service quality, regional round`),
    publications: [],
  });
  const openPrint = async (paper, query = 'doc=resume') => {
    await page.goto(`${BASE}/login`);
    await page.evaluate((p) => { localStorage.setItem('jh.paper', p); localStorage.removeItem('jh.pages'); }, paper);
    await page.goto(`${BASE}/print/${appId}?${query}`);
    await page.waitForSelector('.paged[data-fit]:not([data-fit="pending"])');
    return page.evaluate(() => {
      const el = document.querySelector('.paged');
      return { status: el.dataset.fit, pages: Number(el.dataset.pages), message: document.querySelector('.fitmsg').textContent };
    });
  };
  /** In print layout: every sheet is the paper size and no text hangs below its bottom margin. */
  const printedBoxes = async () => {
    await page.emulateMedia({ media: 'print' });
    const r = await page.evaluate(() =>
      [...document.querySelectorAll('.sheet')].map((s) => {
        const box = s.getBoundingClientRect();
        const pad = parseFloat(getComputedStyle(s).paddingBottom);
        const lowest = Math.max(...[...s.querySelectorAll('[data-bid]')].map((b) => b.getBoundingClientRect().bottom));
        return { w: box.width, h: box.height, spill: lowest - (box.bottom - pad) };
      }),
    );
    await page.emulateMedia({ media: null });
    return r;
  };
  const PAPER_PX = { a4: [793.7, 1122.5], letter: [816, 1056] };
  for (const [name, resume, want] of [
    ['a half-page resume', shaped(1, 2, 0), { pages: 1, status: 'short' }],
    ['a one-page resume', shaped(3, 4, 2), { pages: 1, status: 'ok' }],
    ['a resume between one and two pages', shaped(5, 4, 3), { pages: 2 }],
    ['a two-page resume', shaped(7, 4, 4), { pages: 2 }],
    ['a resume too long for two pages', shaped(12, 6, 6), { status: 'over' }],
  ]) {
    for (const paper of ['a4', 'letter']) {
      await step(`${name} on ${paper}: whole pages, nothing spilling, PDF matches`, async () => {
        eq((await patchApp({ resume })).status, 200);
        const fitted = await openPrint(paper);
        if (want.pages) eq(fitted.pages, want.pages, fitted.message);
        if (want.status) eq(fitted.status, want.status, fitted.message);
        ok(fitted.pages <= 2 || fitted.status === 'over', 'more than two pages must be reported: ' + fitted.message);
        const boxes = await printedBoxes();
        eq(boxes.length, fitted.pages);
        for (const b of boxes) {
          ok(Math.abs(b.w - PAPER_PX[paper][0]) < 1 && Math.abs(b.h - PAPER_PX[paper][1]) < 2, `sheet is the paper size: ${JSON.stringify(b)}`);
          if (fitted.status !== 'over') ok(b.spill <= 1, `text stays inside the margins: ${JSON.stringify(b)}`);
        }
        const file = `test-output/fit-${name.replace(/[^a-z]+/g, '-')}-${paper}.pdf`;
        await page.pdf({ path: file, preferCSSPageSize: true });
        if (fitted.status !== 'over') eq(pdfPages(file), fitted.pages, 'the PDF has exactly the pages shown, no blank extra sheet');
      });
    }
  }
  await step('suggested trimming reaches one page, shows what it left out, and puts it back', async () => {
    eq((await patchApp({ resume: shaped(5, 4, 3) })).status, 200);
    const before = await openPrint('a4');
    eq(before.pages, 2);
    await page.click('button:has-text("Suggest what to leave out")');
    await page.waitForSelector('.paged[data-pages="1"][data-fit="ok"]');
    ok((await page.locator('.fitleft li').count()) > 0, 'the left-out bullets are listed');
    await page.pdf({ path: 'test-output/fit-trimmed.pdf', preferCSSPageSize: true });
    eq(pdfPages('test-output/fit-trimmed.pdf'), 1);
    const saved = await (await fetch(`${BASE}/api/applications/${appId}`, { headers: { cookie } })).json();
    eq(saved.resume.experience[0].bullets.length, 4, 'the saved resume is untouched');
    await page.click('button:has-text("Put all back")');
    await page.selectOption('.fitsel:has-text("Length") select', 'auto');
    await page.waitForSelector('.paged[data-pages="2"]');
  });
  await step('the server makes the same PDF: page count, paper and options', async () => {
    eq((await patchApp({ resume: shaped(3, 4, 2) })).status, 200);
    const get = (q) => fetch(`${BASE}/api/applications/${appId}/pdf?${q}`, { headers: { cookie } });
    const save = async (r, name) => { fs.writeFileSync(`test-output/${name}`, Buffer.from(await r.arrayBuffer())); return pdfPages(`test-output/${name}`); };
    let r = await get('doc=resume&paper=letter');
    eq([r.status, r.headers.get('content-type'), r.headers.get('x-jobhunt-fit'), r.headers.get('x-jobhunt-pages')], [200, 'application/pdf', 'ok', '1']);
    ok(/attachment; filename=".+-resume\.pdf"/.test(r.headers.get('content-disposition')));
    eq(await save(r, 'server-one-letter.pdf'), 1);
    ok(fs.readFileSync('test-output/server-one-letter.pdf', 'latin1').includes('/MediaBox [0 0 612 792]'), 'US Letter paper');
    eq((await patchApp({ resume: shaped(7, 4, 4) })).status, 200);
    r = await get('doc=resume&paper=a4');
    eq([r.status, r.headers.get('x-jobhunt-pages')], [200, '2']);
    eq(await save(r, 'server-two-a4.pdf'), 2);
    r = await get('doc=resume&pages=1');
    eq(r.headers.get('x-jobhunt-fit'), 'over', 'asking for one page of a two-page resume is flagged, not hidden');
    await r.arrayBuffer();
    // Leaving bullets out of this file only, as the Download button does after "Suggest what to leave out".
    const all = shaped(7, 4, 4).experience.flatMap((e) => e.bullets.slice(1)).map((b) => b.replace(/\*\*/g, ''));
    r = await fetch(`${BASE}/api/applications/${appId}/pdf`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ doc: 'resume', paper: 'a4', pages: '1', hidden: all }) });
    eq([r.status, r.headers.get('x-jobhunt-pages')], [200, '1'], await r.clone().text().then((t) => t.slice(0, 200)));
    eq(await save(r, 'server-trimmed.pdf'), 1);
    r = await get('doc=cover');
    eq([r.status, r.headers.get('x-jobhunt-pages'), r.headers.get('x-jobhunt-fit')], [200, '1', 'ok']);
    eq(await save(r, 'server-cover.pdf'), 1);
    eq((await get('paper=a3')).status, 400);
    eq((await fetch(`${BASE}/api/applications/${appId}/pdf`)).status, 401, 'signed out');
    eq((await fetch(`${BASE}/api/applications/a_nope/pdf`, { headers: { cookie } })).status, 404);
  });
  await step('Download PDF in the print view fetches the server file', async () => {
    await openPrint('a4');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Download PDF")')]);
    ok(dl.suggestedFilename().endsWith('-resume.pdf'), dl.suggestedFilename());
    await dl.saveAs('test-output/server-button.pdf');
    eq(pdfPages('test-output/server-button.pdf'), 2);
  });
  await step('a cover letter prints on one page', async () => {
    const fitted = await openPrint('letter', 'doc=cover');
    eq([fitted.pages, fitted.status], [1, 'ok'], fitted.message);
    await page.pdf({ path: 'test-output/fit-cover.pdf', preferCSSPageSize: true });
    eq(pdfPages('test-output/fit-cover.pdf'), 1);
    eq((await patchApp({ resume: original.resume })).status, 200);
    await page.evaluate(() => localStorage.removeItem('jh.paper'));
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
    await page.locator('text=Your Apify account').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-output/10b-settings-account.png', fullPage: true });
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
    await page.locator('.row-job').first().click();
    await page.waitForSelector('.detail.open');
    await page.waitForTimeout(400);
    await shot('11b-mobile-detail');
    await page.click('.back-btn');
    await page.click('.filters-btn');
    await page.waitForTimeout(300);
    await shot('11c-mobile-filters');
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
