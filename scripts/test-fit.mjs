// Run: node --experimental-strip-types scripts/test-fit.mjs
import { assess, outcome, experienceYears, profileYears, AssessmentSchema } from '../src/lib/fit.ts';

let bad = 0;
const check = (name, cond, extra = '') => {
  if (!cond) bad++;
  console.log(cond ? '  ✓' : '  ✗', name, cond ? '' : extra);
};

// ---- experience years ----
const now = new Date('2026-11-11');
const exp = [
  { title: 'AI Engineer', start: 'Jun 2024', end: 'Nov 2025' },
  { title: 'Data Scientist II', start: 'Feb 2026', end: 'Mar 2026' },
  { title: 'Software Development Intern', start: 'Summer 2023', end: 'Summer 2023' },
];
check('counts paid months, skips internships (20 months = 1.7 yrs)', experienceYears(exp, now) === 1.7, String(experienceYears(exp, now)));
check('overlapping roles count once', experienceYears([{ title: 'A', start: 'Jan 2022', end: 'Dec 2022' }, { title: 'B', start: 'Jun 2022', end: 'Mar 2023' }], now) === 1.3);
check('Present runs to today', experienceYears([{ title: 'A', start: 'Nov 2025', end: 'Present' }], now) === 1.1);
check('year-only dates work', experienceYears([{ title: 'A', start: '2020', end: '2022' }], now) === 3);
check('unparseable dates are skipped', experienceYears([{ title: 'A', start: 'a while ago', end: '' }], now) === 0);
check('override wins', profileYears({ experience: exp, preferences: { yearsOverride: 2.5 } }, now) === 2.5);

// ---- scoring ----
const reqs = [
  { skill: 'PyTorch', tier: 'core', evidence: 0.9 },
  { skill: 'LLM fine-tuning', tier: 'core', evidence: 0.9 },
  { skill: 'RL', tier: 'preferred', evidence: 0.7 },
  { skill: 'Publications', tier: 'preferred', evidence: 1 },
];
const base = { job_id: 'j1', reqs, min_years: 3, edge: 0.7, edge_basis: 'pub-1 ICLR paper', domain: 0.85, role: 0.9, location: 'same_country' };
const ctx = { years: 2, baseRate: 0.04, blocked: [], company: 'Acme', daysOld: 2, postedMinYears: null, descChars: 2600, referral: 0, profileText: 'pytorch llm fine-tuning rl publications iclr' };
const parse = (x) => AssessmentSchema.parse(x);
const run = (a, c = {}) => assess(parse(a), { ...ctx, ...c });

const strong = run(base);
check('a good match scores high', strong.detail.fit >= 80 && strong.detail.fit <= 95, String(strong.detail.fit));
check('same input gives the same score', JSON.stringify(run(base)) === JSON.stringify(strong));

const noCore = run({ ...base, reqs: [{ skill: 'LLM fine-tuning', tier: 'core', evidence: 0 }, ...reqs.slice(2)] }, { profileText: ctx.profileText });
check('a missing core skill drags the score down hard', noCore.detail.fit < strong.detail.fit - 20, `${noCore.detail.fit} vs ${strong.detail.fit}`);

const senior = run({ ...base, min_years: 7, seniority: 'senior', edge: 0 });
check('7 years asked of 2 years is a poor fit', senior.detail.fit < 45, String(senior.detail.fit));
check('an edge buys years', run({ ...base, min_years: 4 }).detail.fit > run({ ...base, min_years: 4, edge: 0 }).detail.fit);

const noBasis = run({ ...base, edge_basis: undefined });
check('an edge with no basis is ignored and flagged', noBasis.detail.edge === 0 && noBasis.flags.some((f) => /standout/i.test(f)));

const invented = run({ ...base, reqs: [{ skill: 'Kubernetes', tier: 'core', evidence: 0.9 }, ...reqs.slice(1)] });
check('evidence for a skill the profile never names is capped', invented.detail.reqs[0].evidence === 0.3 && invented.flags.some((f) => /Kubernetes/.test(f)));
const cited = run({ ...base, reqs: [{ skill: 'Kubernetes', tier: 'core', evidence: 0.9, basis: 'exp-1' }, ...reqs.slice(1)] });
check('...unless it cites a profile entry', cited.detail.reqs[0].evidence === 0.9);

// ---- chances ----
const withRef = outcome({ ...strong.detail.stored, referral: 0.8 }, ctx);
check('a referral raises the callback chance a lot', withRef.win_pct > strong.detail.win_pct * 2, `${withRef.win_pct} vs ${strong.detail.win_pct}`);
check('fit does not change with a referral', withRef.fit === strong.detail.fit);
check('crowded postings convert worse', run({ ...base, applicants: 400 }).detail.win_pct < strong.detail.win_pct);
check('stale postings convert worse', run(base, { daysOld: 40 }).detail.win_pct < strong.detail.win_pct);

const visa = run({ ...base, visa_ok: false });
check('no visa sponsorship: tiny chance, effort skip, flagged', visa.detail.win_pct < 2 && visa.detail.effort === 'skip' && visa.flags.some((f) => /authorisation/i.test(f)));
const wrongPlace = run({ ...base, location: 'incompatible' });
check('incompatible location: effort skip', wrongPlace.detail.effort === 'skip');
const blocked = run(base, { blocked: ['acme'] });
check('blocked company: zero chance, skip', blocked.detail.win_pct === 0 && blocked.detail.effort === 'skip');

const thin = run({ ...base, min_years: null }, { descChars: 200 });
check('a thin posting widens the range and is flagged tentative', thin.detail.fit_high - thin.detail.fit_low >= 8 && thin.flags.some((f) => /tentative/i.test(f)), `${thin.detail.fit_low}-${thin.detail.fit_high}`);
check('worth ranks on the cautious end, so thin postings rank below solid ones', thin.detail.worth < strong.detail.worth);
check('fit stays 0-100', [strong, noCore, senior, thin].every((r) => r.detail.fit >= 0 && r.detail.fit <= 100));

const high = run({ ...base, comp: 0.9, growth: 0.9, mission: 0.8 });
check('high appeal + good fit is effort A', high.detail.effort === 'A', high.detail.effort);
check('empty requirement list is neutral, not a crash', Number.isFinite(run({ ...base, reqs: [] }).detail.fit));

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
