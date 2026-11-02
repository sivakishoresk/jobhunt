// A stand-in for api.apify.com used for local testing. Output shapes follow the
// documented fields of each actor. Not a substitute for a real run.
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 4010);
const DELAY = Number(process.env.MOCK_DELAY_MS ?? 4000);
const TOKEN = process.env.MOCK_TOKEN ?? 'test-token';

const TITLES = ['Machine Learning Engineer', 'Senior ML Engineer', 'Applied Scientist', 'LLM Research Engineer', 'Data Scientist', 'AI Engineer', 'Backend Engineer', 'ML Platform Engineer', 'NLP Engineer', 'Computer Vision Engineer', 'MLOps Engineer', 'Research Engineer'];
const COMPANIES = ['Acme AI', 'Northwind', 'Globex', 'Initech', 'Umbrella Labs', 'Hooli', 'Stark Data', 'Wayne Analytics', 'Pied Piper', 'Soylent', 'Cyberdyne', 'Wonka Systems'];
const CITIES = ['Bengaluru, Karnataka, India', 'Mumbai, Maharashtra, India', 'Remote', 'Hyderabad, Telangana, India'];

const YEARS = ['You have 5+ years of experience.', 'Requires 2-4 years of relevant experience.', 'At least 1 year of experience.', 'Great team, flexible hours.'];

const runs = new Map();
const log = [];
let seq = 0;

const day = (n) => new Date(Date.now() - n * 86400e3);
const ymd = (d) => d.toISOString().slice(0, 10);

function items(actor, input) {
  const out = [];
  if (actor === 'curious_coder/linkedin-jobs-scraper') {
    // A few special searches return different subsets so role/place attribution can be tested.
    let kw = '';
    let loc = '';
    try {
      const u = new URL(input.urls?.[0] ?? '');
      kw = (u.searchParams.get('keywords') ?? '').toLowerCase();
      loc = (u.searchParams.get('location') ?? '').toLowerCase();
    } catch {}
    const keepRole = (i) => (kw === 'ai engineer' ? i % 2 === 0 : kw === 'applied scientist' ? i % 3 === 0 : true);
    const keepPlace = (i) => (loc === 'bengaluru' && kw && ['ai engineer', 'applied scientist'].includes(kw) ? i % 4 === 0 : loc === 'mumbai' && ['ai engineer', 'applied scientist'].includes(kw) ? i % 4 === 1 : true);
    for (let i = 0; i < 12; i++) {
      if (!keepRole(i) || !keepPlace(i)) continue;
      const id = String(3692563200 + i);
      out.push({
        id, link: `https://www.linkedin.com/jobs/view/${id}`, title: TITLES[i], companyName: COMPANIES[i], location: CITIES[i % 4],
        salaryInfo: i % 3 === 0 ? ['₹30,00,000', '₹45,00,000'] : [], postedAt: ymd(day(i)),
        descriptionHtml: `<p>We are hiring a <b>${TITLES[i]}</b> at ${COMPANIES[i]}.</p><ul><li>Python and PyTorch</li><li>Own models end to end</li></ul><p>${YEARS[i % 4]}</p>`,
        descriptionText: `We are hiring a ${TITLES[i]} at ${COMPANIES[i]}.\n- Python and PyTorch\n- Own models end to end\n${YEARS[i % 4]} We offer 20% bonus.`,
        seniorityLevel: 'Mid-Senior level', employmentType: 'Full-time', applyUrl: '',
      });
    }
    if (keepRole(0) && keepPlace(0)) out.push({ id: '3692563200', link: 'https://www.linkedin.com/jobs/view/3692563200', title: TITLES[0], companyName: COMPANIES[0], location: CITIES[0], postedAt: ymd(day(0)) }); // duplicate
    out.push({ id: '1', description: 'broken item with no title' });
  } else if (actor === 'fetchclub/linkedin-jobs-scraper') {
    for (let i = 0; i < 8; i++) {
      out.push({
        title: TITLES[i + 2], location: CITIES[i % 4], company_name: COMPANIES[i + 2], posted_datetime: `${ymd(day(i))} 10:09:12`,
        posted_time_ago: `${i + 1} days ago`, base_salary: null, seniority_level: 'Mid-Senior level', employment_type: 'Full-time',
        description_text: `Join ${COMPANIES[i + 2]} as ${TITLES[i + 2]}. Python required. 3+ years.`, description_html: '<p>x</p>',
        job_url: `https://uk.linkedin.com/jobs/view/${TITLES[i + 2].toLowerCase().replace(/ /g, '-')}-40297${59000 + i}`,
        apply_type: 'External Apply', apply_url: `https://example.com/apply/${i}`, job_urn: `urn:li:fsd_jobPosting:40297${59000 + i}`,
      });
    }
  } else if (actor === 'gopalakrishnan/linkedin-jobs') {
    for (let i = 0; i < 5; i++) {
      out.push({ title: TITLES[i], company: COMPANIES[i], location: CITIES[i % 4], postedDate: ymd(day(i)), jobUrl: `https://www.linkedin.com/jobs/view/senior-${i}-at-acme-corp-${5550000 + i}`, searchKeywords: input.keywords });
    }
  } else if (actor === 'tqm/ycombinator-scraper') {
    for (let i = 0; i < 10; i++) {
      out.push({
        source: 'ycombinator', jobId: `yc-${COMPANIES[i].toLowerCase().replace(/ /g, '-')}-${i}`, title: i % 2 ? 'Founding Engineer' : 'Founding ML Engineer',
        company: COMPANIES[i], companyUrl: `https://www.ycombinator.com/companies/${i}`, companyDescription: `${COMPANIES[i]} builds AI-native tooling for backend teams`,
        ycBatch: 'W24', jobUrl: `https://www.ycombinator.com/companies/${i}/jobs/abc${i}`, location: i % 3 === 0 ? 'San Francisco, CA' : 'Remote', remote: i % 3 !== 0,
        salary: '$150K - $200K', salaryMin: 150000, salaryMax: 200000, currency: 'USD', role: 'Engineering', jobType: 'Full-time',
        techStack: i % 2 ? ['typescript', 'react'] : ['python', 'pytorch'], skills: ['python'], scrapedAt: new Date().toISOString(),
      });
    }
  }
  return out;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const send = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === '/__log') return send(200, log);
  let raw = '';
  for await (const c of req) raw += c;
  const auth = req.headers.authorization ?? '';
  if (auth !== `Bearer ${TOKEN}`) return send(401, { error: { type: 'user-or-token-not-found', message: 'User was not found or authentication token is not valid' } });

  let m;
  if (req.method === 'POST' && (m = url.pathname.match(/^\/v2\/acts\/([^/]+)\/runs$/))) {
    const actor = decodeURIComponent(m[1]).replace('~', '/');
    const input = raw ? JSON.parse(raw) : {};
    log.push({ actor, input, query: Object.fromEntries(url.searchParams) });
    if (actor.startsWith('missing/')) return send(404, { error: { type: 'record-not-found', message: 'Actor was not found' } });
    if (actor.startsWith('rental/')) return send(402, { error: { type: 'actor-is-not-rented', message: 'You must rent this actor first' } });
    const id = `run${++seq}`;
    runs.set(id, { actor, input, at: Date.now() });
    return send(201, { data: { id, status: 'READY', defaultDatasetId: `ds${seq}` } });
  }
  if (req.method === 'GET' && (m = url.pathname.match(/^\/v2\/actor-runs\/([^/]+)$/))) {
    const r = runs.get(m[1]);
    if (!r) return send(404, { error: { message: 'run not found' } });
    const status = r.actor.startsWith('fail/') ? 'FAILED' : Date.now() - r.at >= (r.actor.startsWith('slow/') ? 1e9 : DELAY) ? 'SUCCEEDED' : 'RUNNING';
    return send(200, { data: { id: m[1], status, defaultDatasetId: m[1].replace('run', 'ds'), statusMessage: status === 'FAILED' ? 'Actor crashed' : undefined } });
  }
  if (req.method === 'GET' && (m = url.pathname.match(/^\/v2\/datasets\/(legacy\d)\/items$/))) {
    // Datasets of searches made before run-level tracking existed (seeded by the e2e test).
    const mk = (id, city) => ({ id: String(id), link: `https://www.linkedin.com/jobs/view/${id}`, title: `Legacy ${id}`, companyName: 'Old Co', location: city });
    return send(200, m[1] === 'legacy1' ? [mk(3699999001, 'Bengaluru'), mk(3699999002, 'Bengaluru'), mk(3699999003, 'Bengaluru')] : m[1] === 'legacy2' ? [mk(3699999004, 'Mumbai')] : []);
  }
  if (req.method === 'GET' && (m = url.pathname.match(/^\/v2\/datasets\/ds(\d+)\/items$/))) {
    const r = runs.get(`run${m[1]}`);
    const limit = Number(url.searchParams.get('limit') ?? 1000);
    return send(200, r ? items(r.actor, r.input).slice(0, limit) : []);
  }
  send(404, { error: { message: `no route ${req.method} ${url.pathname}` } });
});

server.listen(PORT, () => console.log(`mock apify on ${PORT}`));
