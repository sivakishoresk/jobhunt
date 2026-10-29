import { createHash } from 'node:crypto';

export interface NormJob {
  dedupe_key: string;
  source: string;
  external_id: string | null;
  title: string;
  company: string;
  location: string;
  remote: boolean;
  url: string | null;
  apply_url: string | null;
  description: string;
  posted_at: string | null;
  salary: string | null;
  employment_type: string | null;
  seniority: string | null;
  tags: string[];
}

const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');

function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['name', 'title', 'text', 'label', 'value', 'url']) if (o[k] != null) return text(o[k]);
  }
  return '';
}

class Raw {
  private idx = new Map<string, unknown>();
  constructor(public obj: Record<string, unknown>) {
    for (const [k, v] of Object.entries(obj)) this.idx.set(norm(k), v);
  }
  raw(...aliases: string[]): unknown {
    for (const a of aliases) {
      const v = this.idx.get(norm(a));
      if (v != null && v !== '' && !(Array.isArray(v) && v.length === 0)) return v;
    }
    return undefined;
  }
  str(...aliases: string[]): string {
    for (const a of aliases) {
      const t = text(this.idx.get(norm(a)));
      if (t) return t;
    }
    return '';
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•', hellip: '…' };

export function htmlToText(html: string): string {
  if (!/<[a-z][\s\S]*>/i.test(html)) return html.trim();
  let s = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|h[1-6]|ul|ol|section|tr)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, '');
  s = s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function parseDate(v: unknown, now = new Date()): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    const ms = v > 1e12 ? v : v > 1e9 ? v * 1000 : NaN;
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  const s = String(v).trim();
  if (!s) return null;
  const rel = /(\d+)\s*(minute|min|hour|hr|day|week|month)s?\s*ago/i.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    const mult = unit.startsWith('min') ? 60e3 : unit.startsWith('h') ? 3600e3 : unit === 'day' ? 86400e3 : unit === 'week' ? 7 * 86400e3 : 30 * 86400e3;
    return new Date(now.getTime() - n * mult).toISOString();
  }
  if (/just now|today|moments? ago/i.test(s)) return now.toISOString();
  if (/yesterday/i.test(s)) return new Date(now.getTime() - 86400e3).toISOString();
  if (/^\d{9,13}$/.test(s)) return parseDate(Number(s), now);
  const iso = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s) ? s.replace(' ', 'T') + 'Z' : s;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function salaryOf(r: Raw): string | null {
  const direct = r.raw('salary', 'salaryText', 'salaryRange', 'base_salary', 'baseSalary', 'compensation', 'salaryInfo', 'salaryInsights');
  if (Array.isArray(direct)) {
    const parts = direct.map(text).filter(Boolean);
    if (parts.length) return parts.join(' – ');
  } else if (direct != null) {
    const t = text(direct);
    if (t && t !== 'null') return t;
  }
  const min = r.raw('salaryMin', 'salary_min', 'minSalary');
  const max = r.raw('salaryMax', 'salary_max', 'maxSalary');
  const cur = r.str('currency', 'salaryCurrency');
  if (min != null || max != null) return [cur, min, max != null ? '– ' + max : ''].filter((x) => x !== '' && x != null).join(' ');
  return null;
}

export function normalizeItem(source: string, rawObj: Record<string, unknown>, now = new Date()): NormJob | null {
  const r = new Raw(rawObj);
  const title = r.str('title', 'jobTitle', 'job_title', 'positionName', 'position', 'role_title', 'name');
  if (!title) return null;
  const company = r.str('company', 'companyName', 'company_name', 'organization', 'employer', 'hiringOrganization');
  const location = r.str('location', 'jobLocation', 'job_location', 'formattedLocation', 'city');
  const url = r.str('jobUrl', 'job_url', 'url', 'link', 'jobLink', 'postingUrl', 'absolute_url') || null;
  const applyUrl = r.str('applyUrl', 'apply_url', 'applyLink', 'externalApplyLink') || null;

  let description = htmlToText(
    r.str('descriptionText', 'description_text', 'jobDescription', 'job_description', 'description', 'descriptionHtml', 'description_html', 'content', 'body', 'details'),
  );
  if (!description) {
    const bits = [
      r.str('companyDescription', 'company_description', 'about', 'summary'),
      r.str('role') && `Role: ${r.str('role')}`,
      r.str('ycBatch') && `YC batch: ${r.str('ycBatch')}`,
    ].filter(Boolean);
    description = bits.join('\n\n');
  }

  const tagSource = r.raw('techStack', 'tech_stack', 'skills', 'tags', 'keywords');
  const tags = (Array.isArray(tagSource) ? tagSource.map(text) : text(tagSource).split(/[,;]/))
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);

  const wt = text(r.raw('workplaceTypes', 'workplaceType', 'workplace_type', 'locationType'));
  const remoteRaw = r.raw('remote', 'isRemote', 'is_remote', 'workRemoteAllowed');
  const remote =
    remoteRaw === true || /^(true|yes|1)$/i.test(String(remoteRaw ?? '')) || /remote/i.test(wt) || /\bremote\b/i.test(location) || /\bremote\b/i.test(title);

  let external = r.str('id', 'jobId', 'job_id', 'jobUrn', 'job_urn', 'externalId', 'trackingId');
  const m = /(\d{6,})/.exec(external);
  if (/urn/i.test(external) && m) external = m[1];
  if (!external && url) {
    const um = /(\d{7,})(?:[/?#]|$)/.exec(url);
    if (um) external = um[1];
  }
  const dedupe_key = external
    ? `${source}:${external}`
    : `${source}:h:${createHash('sha1').update([title, company, location].join('|').toLowerCase()).digest('hex').slice(0, 16)}`;

  return {
    dedupe_key,
    source,
    external_id: external || null,
    title: title.slice(0, 300),
    company: company.slice(0, 200),
    location: location.slice(0, 200),
    remote,
    url,
    apply_url: applyUrl,
    description,
    posted_at: parseDate(r.raw('postedAt', 'posted_at', 'postedDate', 'posted_datetime', 'datePosted', 'date_posted', 'publishedAt', 'listedAt', 'postedAtTimestamp', 'posted_time_ago', 'scrapedAt'), now),
    salary: salaryOf(r),
    employment_type: r.str('employmentType', 'employment_type', 'jobType', 'job_type') || null,
    seniority: r.str('seniorityLevel', 'seniority_level', 'seniority', 'experienceLevel') || null,
    tags,
  };
}

/** Used for sources that cannot search by keyword themselves. */
const SYNONYMS: [RegExp, string][] = [
  [/machine[\s-]+learning/g, ' ml '],
  [/artificial[\s-]+intelligence/g, ' ai '],
  [/natural[\s-]+language[\s-]+processing/g, ' nlp '],
  [/large[\s-]+language[\s-]+models?/g, ' llm '],
];
function canon(text: string): string {
  let t = text.toLowerCase();
  for (const [re, to] of SYNONYMS) t = t.replace(re, to);
  return t;
}

export function matchesKeywords(job: NormJob, keywords: string): boolean {
  const tokens = canon(keywords)
    .split(/[\s,/]+/)
    .filter((t) => t.length >= 2 && !['and', 'or', 'the', 'for', 'of', 'in'].includes(t));
  if (!tokens.length) return true;
  const hay = canon([job.title, job.company, job.tags.join(' '), job.description.slice(0, 1500)].join(' '));
  const words = new Set(hay.split(/[^a-z0-9+#.]+/));
  const hits = tokens.filter((t) => (t.length <= 3 ? words.has(t) : hay.includes(t))).length;
  return hits >= Math.max(1, Math.ceil(tokens.length / 2));
}
