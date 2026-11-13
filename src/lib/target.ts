// The role a person is aiming for. Nothing here is tied to one profession: the target is read from
// the profile (Claude fills it in from the resume) and, until then, inferred from titles already there.
// Pure and dependency-free: the browser imports it too.

export interface Target {
  /** The job function in plain words, e.g. "Product management" or "Machine learning engineering". */
  function: string;
  /** Other titles the same job goes by, e.g. "Product Owner" for a product manager. */
  alsoCalled: string[];
}

export interface TargetSource {
  basics?: { headline?: string };
  jobTitles?: string[];
  experience?: { title: string }[];
  target?: Partial<Target>;
}

const LEVEL = /\b(senior|sr|junior|jr|lead|staff|principal|associate|assistant|founding|chief|head of|vp of|vp|vice president of|vice president|director of|intern|trainee|graduate|entry[- ]level|i{1,3}|iv|[1-5])\b\.?/gi;

/** "Senior Product Manager II (Growth), Payments" -> "Product Manager". */
export function roleCore(title: string): string {
  return title
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s[-–—|]\s|,|\s@\s|\sat\s/i)[0]
    .replace(LEVEL, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const uniq = (xs: string[]) => xs.filter((x, i) => x && xs.findIndex((y) => same(x, y)) === i);

/** The target to work with: what the profile says, or the best reading of the titles in it. */
export function effectiveTarget(p: TargetSource): Target & { source: 'profile' | 'inferred' | 'none' } {
  const titles = (p.jobTitles ?? []).map(roleCore).filter(Boolean);
  const stated = p.target?.function?.trim() ?? '';
  const also = uniq([...(p.target?.alsoCalled ?? []), ...titles]);
  if (stated) return { function: stated, alsoCalled: also.filter((x) => !same(x, stated)), source: 'profile' };
  const recent = (p.experience ?? []).map((e) => e.title).find((t) => !/\b(intern|internship|trainee)\b/i.test(t));
  const guess = titles[0] || roleCore(recent ?? '') || roleCore(p.basics?.headline ?? '');
  if (!guess) return { function: '', alsoCalled: [], source: 'none' };
  return { function: guess, alsoCalled: also.filter((x) => !same(x, guess)), source: 'inferred' };
}

/**
 * Other names to accept for one searched role. Only when that role is the person's own target
 * (searching "data analyst" must not let product-owner postings in because the target is product).
 */
export function synonymsFor(keyword: string, p: TargetSource): string[] {
  const t = effectiveTarget(p);
  const family = uniq([t.function, ...t.alsoCalled]);
  const core = roleCore(keyword) || keyword;
  if (!family.some((x) => same(x, core) || same(x, keyword))) return [];
  return family.filter((x) => !same(x, core) && !same(x, keyword));
}

/**
 * Role category for boards that file jobs by department (Y Combinator's Work at a Startup).
 * Only the categories the scraper documents are sent; anything else searches every category
 * and is narrowed by keyword afterwards, so no role family comes back empty.
 */
export function boardRoles(keywords: string): string[] {
  const k = ` ${keywords.toLowerCase()} `;
  if (/\b(design|designer|ux|ui|product design|visual|illustrator|creative)\b/.test(k) && !/\bdesign engineer\b/.test(k)) return ['Design'];
  if (/\b(sales|account executive|account manager|business development|bdr|sdr|partnerships)\b/.test(k) && !/\bsales engineer\b/.test(k)) return ['Sales'];
  if (/\b(engineer|engineering|developer|programmer|software|swe|sde|devops|sre|backend|frontend|full[- ]?stack|ml|ai|machine learning|data scientist|scientist|researcher|architect)\b/.test(k)) return ['Engineering'];
  return [];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One regular expression (valid in JavaScript and Postgres) that matches a lower-cased title containing
 * any of the phrases as whole words. null when there is nothing to avoid.
 */
export function avoidPattern(phrases: string[]): string | null {
  const parts = phrases
    .map((p) => p.toLowerCase().split(/[^a-z0-9+#]+/).filter(Boolean).map(esc).join('[^a-z0-9]+'))
    .filter(Boolean);
  return parts.length ? `(^|[^a-z0-9])(${parts.join('|')})([^a-z0-9]|$)` : null;
}

export interface HideRules {
  avoid: RegExp | null;
  blocked: string[];
}

export function hideRules(prefs?: { avoidRoles?: string[]; blockedCompanies?: string[] }): HideRules {
  const pat = avoidPattern(prefs?.avoidRoles ?? []);
  return { avoid: pat ? new RegExp(pat) : null, blocked: (prefs?.blockedCompanies ?? []).map((b) => b.trim().toLowerCase()).filter(Boolean) };
}

/** Why a listing is hidden by the person's own preferences, or null. */
export function hiddenReason(job: { title: string; company: string }, r: HideRules): string | null {
  if (r.avoid?.test(job.title.toLowerCase())) return 'A kind of role you avoid';
  const c = job.company.toLowerCase();
  if (r.blocked.some((b) => c.includes(b))) return 'A company you skip';
  return null;
}
