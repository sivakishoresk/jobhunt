// Fit scoring v2. Claude reads the posting and the profile and reports structured judgments
// (requirements, evidence, years asked, ratings). This file turns them into numbers, so the
// same facts always give the same score and every number can be explained.
//
// Pure and dependency-light on purpose: the profile page imports profileYears() in the browser.
import { z } from 'zod';

export const LOCATIONS = ['remote', 'match', 'same_country', 'relocate', 'incompatible', 'unknown'] as const;
export const SENIORITY = ['intern', 'junior', 'mid', 'senior', 'staff', 'lead'] as const;
export const TIERS = ['core', 'required', 'preferred'] as const;
export type Effort = 'A' | 'B' | 'C' | 'skip';

export const ReqSchema = z.object({
  skill: z.string().min(1).max(80).describe('The requirement, e.g. "LLM fine-tuning".'),
  tier: z.enum(TIERS).describe('core = what the role is mainly about (1 or 2 per posting); required = other stated must-haves; preferred = nice-to-haves.'),
  evidence: z.number().min(0).max(1).describe('How well the PROFILE proves it: 1 led/shipped with a result, recent; 0.7 substantial work; 0.5 used, shallow or only listed; 0.3 adjacent; 0 nothing.'),
  basis: z.string().max(200).optional().describe('Profile id or title that proves it, e.g. "exp-1". Needed for evidence above 0.3 on anything the profile never names.'),
});

export const AssessmentSchema = z.object({
  job_id: z.string(),
  reqs: z.array(ReqSchema).max(20).default([]),
  min_years: z.number().min(0).max(40).nullable().optional().describe('Years of experience the posting asks for; null if it states none. Defaults to the number read from the text.'),
  seniority: z.enum(SENIORITY).optional().describe('Level of the role, judged from the title AND the responsibilities (owns roadmap, mentors, leads = senior or above).'),
  edge: z.number().min(0).max(1).default(0).describe('How strongly one specific, verifiable achievement in the profile (paper in the field, shipped or open-sourced work, competition win) is directly relevant. 0 if none.'),
  edge_basis: z.string().max(300).optional().describe('Which profile entry the edge comes from (id and a few words). Without it the edge is ignored.'),
  domain: z.number().min(0).max(1).describe('How close the work is to what the profile has done, 0 to 1.'),
  role: z.number().min(0).max(1).describe('How well the job title and role type match what the user is targeting, 0 to 1.'),
  location: z.enum(LOCATIONS).default('unknown').describe('Against preferences.locations and remoteOk.'),
  visa_ok: z.boolean().nullable().optional().describe('false if the posting needs work authorisation the profile lacks (see preferences.workAuthorization); null if unclear.'),
  applicants: z.number().int().min(0).nullable().optional().describe('Only if the posting shows an applicant count.'),
  comp: z.number().min(0).max(1).nullable().optional().describe('How good the pay looks against preferences.salaryFloor; omit if unknown.'),
  growth: z.number().min(0).max(1).nullable().optional().describe('Learning and career value, judged against preferences.priorities.'),
  mission: z.number().min(0).max(1).nullable().optional().describe('Interest in the company and problem, judged against preferences.priorities.'),
  reasons: z.array(z.string().max(300)).max(6).optional(),
  flags: z.array(z.string().max(300)).max(6).optional(),
});
export type Assessment = z.infer<typeof AssessmentSchema>;

/** What jobs_to_score hands Claude so every session fills the fields the same way. */
export const RUBRIC = `Score with score_jobs({assessments:[...]}) - do NOT invent a 0-100 number; the server computes it from your judgments.
For each job:
1. reqs: the 3-10 requirements that would decide the hire. Mark 1-2 as tier "core" (what the role is mainly about: the title and first responsibilities), stated must-haves as "required", nice-to-haves as "preferred". Skip boilerplate.
2. evidence per requirement, from the PROFILE ONLY: 1.0 led or shipped it with a result, recently; 0.7 substantial work in a job or project; 0.5 used it but shallow, or only listed in skills; 0.3 adjacent or transferable; 0 nothing there. Give basis (profile id) when the profile never names the skill.
3. min_years from the posting (null if not stated) and seniority from the title AND responsibilities.
4. edge (0-1) plus edge_basis: only for a specific, verifiable achievement in the profile that is directly relevant (a paper in the field, shipped or open-sourced work, a competition win). No basis, no edge.
5. domain and role (0-1): closeness of the work and of the job type to the profile and preferences.
6. location against preferences; visa_ok=false if the posting needs authorisation the profile lacks; applicants only if shown; comp, growth, mission from preferences (omit when you cannot tell).
7. reasons and flags: short, plain, tied to the posting. A posting with a short or missing description gets a flag saying so.
Be a strict hiring manager: look for the one reason to say no, and do not give evidence the profile does not show.`;

// ---------- profile years ----------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function monthIndex(text: string, endOfPeriod: boolean, now: Date): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (/present|current|now|ongoing|till date|to date/.test(t)) return now.getFullYear() * 12 + now.getMonth();
  const y = /(?:19|20)\d{2}/.exec(t);
  if (!y) return null;
  const m = MONTHS.findIndex((x) => new RegExp(`\\b${x}`).test(t));
  return Number(y[0]) * 12 + (m >= 0 ? m : endOfPeriod ? 11 : 0);
}

/** Months of paid, non-intern experience in the profile (overlaps counted once), as years to one decimal. */
export function experienceYears(experience: { title: string; start: string; end: string }[], now = new Date()): number {
  const spans: [number, number][] = [];
  for (const e of experience) {
    if (/\b(intern|internship|trainee|apprentice)\b/i.test(e.title)) continue;
    const a = monthIndex(e.start, false, now);
    const b = e.end.trim() ? monthIndex(e.end, true, now) : a != null ? now.getFullYear() * 12 + now.getMonth() : null;
    if (a == null || b == null || b < a) continue;
    spans.push([a, b]);
  }
  spans.sort((x, y) => x[0] - y[0]);
  let months = 0;
  let cur: [number, number] | null = null;
  for (const s of spans) {
    if (cur && s[0] <= cur[1] + 1) cur[1] = Math.max(cur[1], s[1]);
    else {
      if (cur) months += cur[1] - cur[0] + 1;
      cur = [s[0], s[1]];
    }
  }
  if (cur) months += cur[1] - cur[0] + 1;
  return Math.round((months / 12) * 10) / 10;
}

/** The number used when scoring: the user's own figure if they set one, otherwise counted from the dates. */
export function profileYears(p: { experience: { title: string; start: string; end: string }[]; preferences?: { yearsOverride?: number | null } }, now = new Date()): number {
  const o = p.preferences?.yearsOverride;
  return o != null ? o : experienceYears(p.experience, now);
}

// ---------- the model ----------

const floor = (v: number) => Math.max(v, 0.05);
const LEVEL: Record<string, number> = { intern: 0, junior: 1, mid: 2, senior: 3, staff: 4, lead: 4 };
const levelOf = (yrs: number) => (yrs < 1 ? 0 : yrs < 3 ? 1 : yrs < 6 ? 2 : yrs < 9 ? 3 : 4);
const LOCATION_OK = new Set(['remote', 'match', 'same_country', 'relocate', 'unknown']);

/** Weighted geometric mean: one weak part drags the whole down, so a strength cannot hide a deal-breaker. */
function wgm(parts: [number, number][]): number {
  const w = parts.reduce((a, [, x]) => a + x, 0);
  return Math.exp(parts.reduce((a, [v, x]) => a + x * Math.log(floor(v)), 0) / w);
}

function skillsPart(reqs: { tier: string; evidence: number }[]): { score: number; coverage: number; coreMin: number } {
  let num = 0;
  let den = 0;
  const core: number[] = [];
  for (const r of reqs) {
    const w = r.tier === 'core' ? 2 : r.tier === 'required' ? 1 : 0.5;
    num += w * r.evidence;
    den += w;
    if (r.tier === 'core') core.push(r.evidence);
  }
  const coverage = den ? num / den : 0.5;
  const coreMin = core.length ? Math.min(...core) : coverage;
  return { score: Math.sqrt(floor(coverage) * floor(coreMin)), coverage, coreMin };
}

/** 1 when you meet the ask, smoothly less the further short you are. A strong relevant edge buys up to 2 years. */
function yearsPart(min: number | null, years: number, edge: number, seniority?: string): number {
  let y = 0.7; // not stated: neutral
  if (min != null) y = Math.exp(-0.5 * (Math.max(0, min - years - 2 * edge) / 2) ** 2);
  if (seniority) {
    const diff = (LEVEL[seniority] ?? levelOf(years)) - levelOf(years);
    y = Math.min(y, 0.6 ** Math.max(0, diff - 1)); // one level up is fine, two or more is not
  }
  return y;
}

/** What is needed to recompute chances later (for example when a referral is added) without asking Claude again. */
export interface Stored {
  qual: number;
  half: number;
  want: number;
  applicants: number | null;
  location: string;
  visa_ok: boolean | null;
  referral: number;
}

export interface OutcomeCtx {
  baseRate: number;
  blocked: string[];
  daysOld: number;
  company: string;
}

export const isBlocked = (company: string, blocked: string[]) => blocked.some((b) => b.trim() && company.toLowerCase().includes(b.trim().toLowerCase()));

/** Estimated chance of a callback. A prior, not a forecast: use it to rank, and replace baseRate with your own rate. */
function winOf(qual: number, s: Stored, c: OutcomeCtx): number {
  const p0 = Math.min(0.5, Math.max(0.005, c.baseRate));
  let odds = (p0 / (1 - p0)) * Math.exp(6 * (qual - 0.6));
  if (s.applicants != null) odds *= s.applicants > 200 ? 0.6 : s.applicants > 100 ? 0.8 : 1;
  if (c.daysOld > 21) odds *= 0.7; // stale or ghost risk
  odds *= Math.exp(1.8 * s.referral); // a warm path
  let p = odds / (1 + odds);
  if (s.visa_ok === false) p *= 0.05;
  if (!LOCATION_OK.has(s.location)) p *= 0.02;
  if (isBlocked(c.company, c.blocked)) p = 0;
  return p;
}

export interface Outcome {
  fit: number;
  fit_low: number;
  fit_high: number;
  win_pct: number;
  worth: number;
  effort: Effort;
}

export function outcome(s: Stored, c: OutcomeCtx): Outcome {
  const win = winOf(s.qual, s, c);
  const worthLow = winOf(Math.max(0, s.qual - s.half), s, c) * s.want; // rank on the cautious end
  const gated = isBlocked(c.company, c.blocked) || s.visa_ok === false || !LOCATION_OK.has(s.location);
  const effort: Effort = gated || win < 0.01 ? 'skip' : s.want >= 0.7 && s.qual >= 0.6 ? 'A' : s.qual >= 0.6 ? 'B' : 'C';
  const pct = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 100);
  return {
    fit: pct(s.qual),
    fit_low: pct(s.qual - s.half),
    fit_high: pct(s.qual + s.half),
    win_pct: Math.round(win * 1000) / 10,
    worth: Math.round(worthLow * 1000) / 10,
    effort,
  };
}

export interface ScoreDetail extends Outcome {
  v: 2;
  want: number;
  confidence: number;
  parts: { skills: number; core_min: number; coverage: number; years: number; domain: number; role: number };
  reqs: { skill: string; tier: string; evidence: number }[];
  edge: number;
  edge_basis: string;
  inputs: { profile_years: number; min_years: number | null; days_old: number; applicants: number | null; location: string; visa_ok: boolean | null };
  stored: Stored;
}

export interface AssessCtx extends OutcomeCtx {
  years: number;
  /** Years read from the posting text, used when Claude gives none. */
  postedMinYears: number | null;
  descChars: number;
  referral: number;
  /** Lower-cased profile text, to check that claimed evidence exists. */
  profileText: string;
}

const significant = (s: string) => s.toLowerCase().split(/[^a-z0-9+#.]+/).filter((t) => t.length >= 3);

export function assess(a: Assessment, c: AssessCtx): { detail: ScoreDetail; flags: string[] } {
  const flags: string[] = [];

  // Claimed evidence must exist in the profile; otherwise it counts as adjacent at best.
  const reqs = a.reqs.map((r) => {
    let evidence = r.evidence;
    const toks = significant(r.skill);
    const named = !toks.length || toks.some((t) => c.profileText.includes(t));
    const cited = /\b(exp|proj|edu|ach|pub)-\d+\b/.test(r.basis ?? '');
    if (evidence > 0.3 && !named && !cited) {
      evidence = 0.3;
      flags.push(`Your profile does not name "${r.skill}", so it was counted as adjacent only.`);
    }
    return { skill: r.skill, tier: r.tier as string, evidence };
  });

  let edge = a.edge;
  if (edge > 0 && !a.edge_basis?.trim()) {
    edge = 0;
    flags.push('A standout strength was claimed without naming it in the profile, so it was ignored.');
  }

  const minYears = a.min_years !== undefined ? a.min_years : c.postedMinYears;
  const sk = skillsPart(reqs);
  const yrs = yearsPart(minYears, c.years, edge, a.seniority);
  const qual = wgm([[sk.score, 0.45], [yrs, 0.25], [(a.domain + a.role) / 2, 0.3]]);

  let conf = 0.5 + 0.5 * Math.min(1, c.descChars / 1500);
  if (minYears == null) conf -= 0.1;
  conf = Math.max(0.2, Math.min(1, conf));

  const want = 0.4 * (a.comp ?? 0.5) + 0.35 * (a.growth ?? 0.5) + 0.25 * (a.mission ?? 0.5);
  const stored: Stored = {
    qual: Math.round(qual * 1000) / 1000,
    half: Math.round((1 - conf) * 0.2 * 1000) / 1000,
    want: Math.round(want * 1000) / 1000,
    applicants: a.applicants ?? null,
    location: a.location,
    visa_ok: a.visa_ok ?? null,
    referral: c.referral,
  };
  const o = outcome(stored, c);

  if (isBlocked(c.company, c.blocked)) flags.unshift('This company is on your blocklist.');
  if (a.visa_ok === false) flags.unshift('Needs work authorisation you do not have.');
  if (a.location === 'incompatible') flags.unshift('Location does not work for you.');
  if (conf < 0.6) flags.push('Thin posting: treat this score as tentative.');

  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    flags,
    detail: {
      v: 2,
      ...o,
      want: r2(want),
      confidence: r2(conf),
      parts: { skills: r2(sk.score), core_min: r2(sk.coreMin), coverage: r2(sk.coverage), years: r2(yrs), domain: r2(a.domain), role: r2(a.role) },
      reqs,
      edge: r2(edge),
      edge_basis: edge > 0 ? (a.edge_basis ?? '').trim() : '',
      inputs: { profile_years: c.years, min_years: minYears ?? null, days_old: Math.round(c.daysOld), applicants: a.applicants ?? null, location: a.location, visa_ok: a.visa_ok ?? null },
      stored,
    },
  };
}

export const EFFORT_TEXT: Record<Effort, string> = {
  A: 'Worth a referral and a fully tailored application',
  B: 'Apply with a tailored resume',
  C: 'Quick apply, low priority',
  skip: 'Skip',
};
