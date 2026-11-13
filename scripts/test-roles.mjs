// Run: node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-roles.mjs
// Checks that nothing assumes one profession: target role, title matching, relevant years, evidence rules,
// resume sections, and LinkedIn messages. Three very different people are used throughout.
import { roleCore, effectiveTarget, synonymsFor, boardRoles, avoidPattern, hideRules, hiddenReason } from '../src/lib/target.ts';
import { matchesKeywords } from '../src/lib/normalize.ts';
import { assess, AssessmentSchema } from '../src/lib/fit.ts';
import { layoutOf } from '../src/lib/layout.ts';
import { factScanner } from '../src/lib/facts.ts';
import { checkOutreach, mergeOutreach, outreachOf, EMPTY_OUTREACH, CONNECT_FREE } from '../src/lib/outreach.ts';

let bad = 0;
const check = (name, cond, extra = '') => {
  if (!cond) bad++;
  console.log(cond ? '  ✓' : '  ✗', name, cond ? '' : extra);
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- three people ----------
const pm = {
  basics: { name: 'Asha Rao', headline: 'Product manager, payments', summary: '', location: 'Pune', email: '', phone: '', links: [] },
  skills: ['SQL', 'Roadmapping', 'A/B testing', 'Figma'],
  jobTitles: ['Senior Product Manager', 'Product Owner'],
  experience: [
    { id: 'exp-1', title: 'Product Manager', company: 'Paywell', location: '', start: 'Jan 2023', end: 'Present', bullets: ['Owned the checkout roadmap; lifted conversion 12% across 3 markets', 'Ran discovery with 40 merchants'] },
    { id: 'exp-2', title: 'Software Engineer', company: 'Coreline', location: '', start: 'Jul 2018', end: 'Dec 2022', bullets: ['Built billing APIs in Java'] },
  ],
  projects: [], education: [], achievements: [{ id: 'ach-1', text: 'Certified Scrum Product Owner (CSPO), 2023' }], publications: [],
  preferences: { avoidRoles: ['product marketing', 'project manager'], blockedCompanies: ['Globex'] },
  target: { function: '', alsoCalled: [] },
};
const nurse = { jobTitles: [], experience: [{ title: 'Registered Nurse (ICU)', start: '2019', end: 'Present' }], target: { function: '', alsoCalled: [] } };
const mle = { jobTitles: ['Machine Learning Engineer', 'Applied Scientist'], experience: [{ title: 'AI Engineer' }], target: { function: 'Machine learning engineering', alsoCalled: ['Research Engineer'] } };
const now = new Date('2026-11-13');

console.log('target role');
check('level words and teams are stripped from a title', roleCore('Senior Product Manager II (Growth), Payments') === 'Product Manager', roleCore('Senior Product Manager II (Growth), Payments'));
check('inferred from search titles when not set', eq([effectiveTarget(pm).function, effectiveTarget(pm).source], ['Product Manager', 'inferred']), JSON.stringify(effectiveTarget(pm)));
check('inferred from the latest job when there are no titles', effectiveTarget(nurse).function === 'Registered Nurse', effectiveTarget(nurse).function);
check('what the person set wins', eq([effectiveTarget(mle).function, effectiveTarget(mle).source], ['Machine learning engineering', 'profile']));
check('an empty profile has no target', effectiveTarget({}).source === 'none');
check('other names apply to the person\'s own role', synonymsFor('product manager', pm).includes('Product Owner'), JSON.stringify(synonymsFor('product manager', pm)));
check('...and not to an unrelated search', synonymsFor('data analyst', pm).length === 0);
check('board category follows the search', eq([boardRoles('machine learning engineer'), boardRoles('product designer'), boardRoles('account executive'), boardRoles('product manager'), boardRoles('registered nurse')], [['Engineering'], ['Design'], ['Sales'], [], []]));

console.log('title matching');
const job = (title, description = '', tags = []) => ({ title, company: 'Acme', tags, description });
check('product manager matches its title', matchesKeywords(job('Senior Product Manager, Growth'), 'product manager'));
check('...but not a designer whose posting mentions a manager', !matchesKeywords(job('Product Designer', 'You will work with the product manager daily.'), 'product manager'));
check('...nor a product marketing role searched as a designer', !matchesKeywords(job('Product Marketing Lead', 'Design campaigns'), 'product designer'));
check('another name for the same job counts', matchesKeywords(job('Product Owner'), 'product manager', ['Product Owner']));
check('...only when given', !matchesKeywords(job('Product Owner'), 'product manager'));
check('the head word in the title plus the rest in the text still matches', matchesKeywords(job('Founding Engineer', 'We build ML systems for clinics'), 'machine learning engineer'));
check('a generic engineer with no ML anywhere does not', !matchesKeywords(job('Founding Engineer', 'We build billing software'), 'machine learning engineer'));
check('abbreviations are understood', matchesKeywords(job('Sr. ML Engineer'), 'senior machine learning engineer'));
check('a skills search matches on tags', matchesKeywords(job('Backend Developer', '', ['Python', 'Django']), 'python django'));
check('a nurse search works like any other', matchesKeywords(job('Registered Nurse - ICU'), 'registered nurse') && !matchesKeywords(job('Nurse Recruiter'), 'registered nurse'));

console.log('hidden by preferences');
const rules = hideRules(pm.preferences);
check('a title you avoid is hidden', hiddenReason({ title: 'Senior Product Marketing Manager', company: 'Acme' }, rules) !== null);
check('whole words only', hiddenReason({ title: 'Product Manager', company: 'Acme' }, rules) === null);
check('a company you skip is hidden', hiddenReason({ title: 'Product Manager', company: 'Globex India' }, rules) !== null);
check('nothing to avoid means no pattern', avoidPattern([]) === null && hiddenReason({ title: 'X', company: 'Y' }, hideRules({})) === null);
check('the pattern is plain enough for Postgres', /^[\x20-\x7e]+$/.test(avoidPattern(['C++ developer', 'sales engineer'])) && new RegExp(avoidPattern(['C++ developer'])).test('senior c++ developer'));

console.log('scoring for a career changer');
const ids = new Set(['exp-1', 'exp-2', 'ach-1']);
const ctx = { years: 8.3, baseRate: 0.04, blocked: [], company: 'Acme', daysOld: 2, postedMinYears: null, descChars: 2600, referral: 0, profileText: JSON.stringify(pm).toLowerCase(), profileIds: ids, experience: pm.experience, now };
const base = {
  job_id: 'j1', min_years: 5, domain: 0.8, role: 0.9, location: 'match',
  reqs: [
    { skill: 'Roadmap ownership', kind: 'skill', tier: 'core', evidence: 1, basis: 'exp-1 owned the checkout roadmap' },
    { skill: 'SQL', kind: 'tool', tier: 'required', evidence: 0.5 },
  ],
};
const run = (a) => assess(AssessmentSchema.parse(a), ctx);
const all = run(base);
const relevant = run({ ...base, relevant_experience: ['exp-1'] });
check('without a list, every year counts', all.detail.inputs.profile_years === 8.3 && all.detail.inputs.total_years === undefined);
check('only product years count for a product role', relevant.detail.inputs.profile_years === 3.9 && relevant.detail.inputs.total_years === 8.3, JSON.stringify(relevant.detail.inputs));
check('...which lowers the fit and says why', relevant.detail.fit < all.detail.fit && relevant.flags.some((f) => /3\.9 of your 8\.3 years/.test(f)), `${relevant.detail.fit} vs ${all.detail.fit}`);
check('listing everything changes nothing', run({ ...base, relevant_experience: ['exp-1', 'exp-2'] }).detail.fit === all.detail.fit);
check('no relevant experience counts as zero years', run({ ...base, relevant_experience: [] }).detail.inputs.profile_years === 0);
check('an id that is not in the profile is ignored and flagged', run({ ...base, relevant_experience: ['exp-1', 'exp-9'] }).flags.some((f) => /exp-9/.test(f)));
const soft = (extra) => run({ ...base, reqs: [{ skill: 'Stakeholder management', kind: 'soft', tier: 'core', evidence: 0.9, ...extra }] });
check('a soft skill with no basis is cut to adjacent', soft({}).detail.reqs[0].evidence === 0.3 && soft({}).flags.some((f) => /Stakeholder/.test(f)));
check('...a made-up id does not help', soft({ basis: 'exp-7 led reviews' }).detail.reqs[0].evidence === 0.3);
check('...a real one does', soft({ basis: 'exp-1 ran discovery with merchants' }).detail.reqs[0].evidence === 0.9);
const vague = run({ ...base, reqs: [{ skill: 'Product strategy', kind: 'skill', tier: 'core', evidence: 1 }] });
check('a word match alone is worth "mentioned", not "led"', vague.detail.reqs[0].evidence === 0.5, String(vague.detail.reqs[0].evidence));
check('tools keep the old rule: named in the profile is enough', run(base).detail.reqs[1].evidence === 0.5 && run({ ...base, reqs: [{ skill: 'Figma', tier: 'core', evidence: 0.7 }] }).detail.reqs[0].evidence === 0.7);
check('director-level roles are understood', Number.isFinite(run({ ...base, seniority: 'director' }).detail.fit) && run({ ...base, seniority: 'director', relevant_experience: ['exp-1'] }).detail.fit < relevant.detail.fit);

console.log('resume sections');
check('default order when nothing is chosen', eq(layoutOf().map((s) => s.key), ['summary', 'skills', 'experience', 'projects', 'education', 'achievements', 'publications']));
const lay = layoutOf([{ key: 'experience' }, { key: 'achievements', title: 'Certifications & Awards' }, { key: 'experience' }, { key: 'nonsense' }]);
check('chosen sections come first, renamed, and nothing is dropped', eq(lay.slice(0, 2), [{ key: 'experience', title: 'Experience' }, { key: 'achievements', title: 'Certifications & Awards' }]) && lay.length === 7);

console.log('fact checks');
const posting = { title: 'Senior Product Manager', company: 'Northwind', description: 'Own the payments roadmap. 5+ years. We process $1.2M a day.' };
const scan = factScanner(pm, posting);
check('figures from the profile and the posting pass', scan('x', 'Lifted conversion 12% across 3 markets; you process 1.2 million a day').length === 0, JSON.stringify(scan('x', 'Lifted conversion 12% across 3 markets; you process 1.2 million a day')));
check('an invented figure is caught, shown as written', eq(scan('x', 'Grew revenue 45% last year').map((c) => c.text), ['45%']));
check('an employer that is not in the profile is caught', scan('x', 'I led pricing at Stripe for a year').some((c) => c.text === 'Stripe'));

console.log('LinkedIn messages');
const good = {
  connect_note: 'Hi [Name], I am a product manager at Paywell (checkout, conversion up 12%) and applied for the Senior Product Manager role at Northwind. Glad to connect.',
  message: 'Hi [Name],\n\nI applied for the Senior Product Manager role at Northwind. I own the checkout roadmap at Paywell and lifted conversion 12% across 3 markets.\n\nAre you the right person to talk to about it?\n\nAsha',
  referral_ask: '',
};
check('a short, specific message passes clean', checkOutreach(pm, posting, outreachOf(good)).length === 0, JSON.stringify(checkOutreach(pm, posting, outreachOf(good))));
check(`the good note fits a free account (${[...good.connect_note].length} <= ${CONNECT_FREE})`, [...good.connect_note].length <= CONNECT_FREE);
const issues = (o) => checkOutreach(pm, posting, outreachOf(o)).map((c) => c.issue).join(' | ');
check('a note over 200 characters is flagged for free accounts', /free LinkedIn account/.test(issues({ connect_note: 'a'.repeat(240) })));
check('...and over 300 cannot be sent', /will not send/.test(issues({ connect_note: 'a'.repeat(320) })));
check('pleasantries are flagged', /Pleasantry/.test(issues({ message: 'Hi [Name], I hope this message finds you well. Could we talk about the role?' })));
check('"my name is" is flagged', /shows your name/.test(issues({ message: 'Hi, my name is Asha. Could we talk about the role?' })));
check('a message with no ask is flagged', /no ask/.test(issues({ message: 'I applied for the Senior Product Manager role at Northwind.' })));
check('a cover-letter-length message is flagged', /Long for a LinkedIn message/.test(issues({ referral_ask: 'I own the checkout roadmap. '.repeat(30) + 'Would you refer me?' })));
check('invented facts are flagged here too', /not in your profile/.test(issues({ message: 'I grew revenue 45% at Stripe. Could we talk?' })));
const merged = mergeOutreach(pm, posting, outreachOf(good), { referral_ask: 'Hi [Name], would you be open to referring me for the Senior Product Manager role at Northwind?' });
check('saving one message keeps the others', merged.connect_note === good.connect_note && merged.referral_ask.startsWith('Hi [Name], would') && merged.checks.length === 0, JSON.stringify(merged.checks));
check('nothing stored reads as empty', eq(outreachOf(null), EMPTY_OUTREACH) && eq(outreachOf({ message: 5 }), EMPTY_OUTREACH));

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
