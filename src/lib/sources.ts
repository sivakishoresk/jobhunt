import { z } from 'zod';
import { kvGet, kvSet } from './db';

/** One scraper run: a single role and a single place. */
export interface RunQuery {
  keywords: string;
  location: string;
  remote: boolean;
  days: number | null;
  /** LinkedIn experience level codes 1-6 (1 internship … 6 executive). Empty or missing means any. */
  experience?: number[];
}

/** What the user asks for: any number of roles and places. Older saved searches hold plain strings. */
export interface SearchQuery {
  keywords: string | string[];
  location: string | string[];
  remote: boolean;
  days: number | null;
  experience?: number[];
  sources?: string[];
}

export const MAX_TERMS = 5;
export const MAX_RUNS = 24;

export const asList = (v: string | string[] | undefined): string[] => {
  const seen = new Set<string>();
  return (Array.isArray(v) ? v : [v ?? ''])
    .map((x) => x.trim())
    .filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
};

/** Every role x place pair. No place means one unrestricted run per role. */
export function runQueries(q: SearchQuery): RunQuery[] {
  const roles = asList(q.keywords);
  const places = asList(q.location);
  return roles.flatMap((keywords) =>
    (places.length ? places : ['']).map((location) => ({ keywords, location, remote: q.remote, days: q.days, experience: q.experience })),
  );
}

export const SourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{2,24}$/),
  label: z.string().min(1).max(40),
  enabled: z.boolean(),
  preset: z.string().max(40).default('custom'),
  actor: z.string().min(3).max(120),
  input: z.any(),
  maxResults: z.number().int().min(1).max(500),
  localKeywordFilter: z.boolean().default(false),
});
export type SourceConfig = z.infer<typeof SourceSchema>;

export interface Preset {
  id: string;
  label: string;
  note: string;
  actor: string;
  input: unknown;
  maxResults: number;
  localKeywordFilter: boolean;
}

export const PRESETS: Preset[] = [
  {
    id: 'linkedin_curious',
    label: 'LinkedIn · curious_coder',
    note: 'Pay per result (about $1 per 1,000 jobs). Takes a LinkedIn search URL. Input field names should be confirmed with the Test button.',
    actor: 'curious_coder/linkedin-jobs-scraper',
    input: { urls: ['{{linkedinSearchUrl}}'], count: '{{maxResults}}' },
    maxResults: 25,
    localKeywordFilter: false,
  },
  {
    id: 'linkedin_fetchclub',
    label: 'LinkedIn · fetchclub',
    note: 'Monthly rental plus usage on Apify. Input fields confirmed from the actor schema. Returns full descriptions.',
    actor: 'fetchclub/linkedin-jobs-scraper',
    input: {
      search_url: '{{linkedinSearchUrl}}',
      max_results: '{{maxResults}}',
      include_company_details: false,
      proxy_group: 'DATACENTER',
    },
    maxResults: 25,
    localKeywordFilter: false,
  },
  {
    id: 'linkedin_gopalakrishnan',
    label: 'LinkedIn · gopalakrishnan (cheap, thin)',
    note: 'Very cheap, keyword and location input. Returns title, company, location, date and link only, with no description.',
    actor: 'gopalakrishnan/linkedin-jobs',
    input: { keywords: '{{keywords}}', location: '{{location}}', maxResults: '{{maxResults}}' },
    maxResults: 25,
    localKeywordFilter: false,
  },
  {
    id: 'yc_tqm',
    label: 'Y Combinator · tqm',
    note: 'Work at a Startup listings. No keyword search, so Jobhunt filters the results by your keywords. Returns at most 50 jobs per run.',
    actor: 'tqm/ycombinator-scraper',
    input: { maxJobs: '{{maxResults}}', roles: ['Engineering'], remoteOnly: '{{remote}}', failOnZeroResults: false },
    maxResults: 50,
    localKeywordFilter: true,
  },
];

export const DEFAULT_SOURCES: SourceConfig[] = [
  { id: 'linkedin', label: 'LinkedIn', enabled: true, preset: 'linkedin_curious', ...pick('linkedin_curious') },
  { id: 'yc', label: 'Y Combinator', enabled: true, preset: 'yc_tqm', ...pick('yc_tqm') },
];

function pick(id: string) {
  const p = PRESETS.find((x) => x.id === id)!;
  return { actor: p.actor, input: p.input, maxResults: p.maxResults, localKeywordFilter: p.localKeywordFilter };
}

export async function getSources(): Promise<SourceConfig[]> {
  const stored = await kvGet<unknown>('sources');
  const parsed = z.array(SourceSchema).safeParse(stored);
  return parsed.success && parsed.data.length ? parsed.data : DEFAULT_SOURCES;
}

export async function saveSources(sources: unknown): Promise<SourceConfig[]> {
  const parsed = z.array(SourceSchema).min(1).max(8).parse(sources);
  const ids = new Set(parsed.map((s) => s.id));
  if (ids.size !== parsed.length) throw new Error('Each source needs a unique id.');
  await kvSet('sources', parsed);
  return parsed;
}

// ---- input templates ----

export function linkedinSearchUrl(q: RunQuery): string {
  const p = new URLSearchParams();
  if (q.keywords) p.set('keywords', q.keywords);
  if (q.location) p.set('location', q.location);
  if (q.days) p.set('f_TPR', `r${Math.round(q.days * 86400)}`);
  if (q.remote) p.set('f_WT', '2');
  const levels = [...new Set((q.experience ?? []).filter((n) => Number.isInteger(n) && n >= 1 && n <= 6))].sort();
  if (levels.length) p.set('f_E', levels.join(','));
  p.set('sortBy', 'DD');
  p.set('position', '1');
  p.set('pageNum', '0');
  return `https://www.linkedin.com/jobs/search/?${p.toString()}`;
}

export function renderInput(template: unknown, q: RunQuery, maxResults: number): unknown {
  const vars: Record<string, unknown> = {
    keywords: q.keywords,
    location: q.location,
    maxResults,
    remote: q.remote,
    days: q.days ?? '',
    linkedinSearchUrl: linkedinSearchUrl(q),
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const whole = /^\{\{\s*(\w+)\s*\}\}$/.exec(v);
      if (whole && whole[1] in vars) return vars[whole[1]];
      return v.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (k in vars ? String(vars[k]) : ''));
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(template);
}
