import { z } from 'zod';
import type { Profile } from './profile';
import { profileText } from './profile';

export interface ResumeDoc {
  name: string;
  headline: string;
  contact: string[];
  summary: string;
  skills: string[];
  experience: { title: string; company: string; location: string; start: string; end: string; bullets: string[] }[];
  projects: { name: string; link: string; start: string; end: string; bullets: string[] }[];
  education: { degree: string; school: string; start: string; end: string; detail: string }[];
  achievements: string[];
  publications: string[];
}

export interface Check {
  where: string;
  text: string;
  issue: string;
}

export const DraftInputSchema = z.object({
  job_id: z.string().min(1),
  application_id: z.string().optional(),
  headline: z.string().optional(),
  summary: z.string().optional(),
  skills: z.array(z.string()).optional(),
  experience: z.array(z.object({ profile_id: z.string(), bullets: z.array(z.string()).default([]) })).default([]),
  projects: z.array(z.object({ profile_id: z.string(), bullets: z.array(z.string()).default([]) })).default([]),
  education: z.array(z.string()).default([]),
  achievements: z.array(z.string()).default([]).describe('Scholastic achievement ids from the profile (ach-1, ...). Copied word for word.'),
  publications: z.array(z.string()).default([]),
  cover_letter: z.string().default(''),
  gaps: z.array(z.string()).default([]),
});
export type DraftInput = z.infer<typeof DraftInputSchema>;

export interface JobContext {
  title: string;
  company: string;
  description: string;
}

const STOP = new Set(
  `dear hello hi sincerely regards best kind thanks thank you your yours hiring team manager monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december present current the and for with this that from have has our we i my`
    .split(' '),
);

function normNumber(tok: string): string {
  return tok.toLowerCase().replace(/[$₹,\s]/g, '');
}

const NUM_RE = /(?<![A-Za-z0-9.])[$₹]?\d[\d,]*(?:\.\d+)?\s?(?:%|x|k|m|b|cr|lakhs?)?(?![A-Za-z0-9])/gi;
const CAP_RE = /\b[A-Z][A-Za-z0-9+#.\-]{2,}\b/g;

function numbersIn(s: string): string[] {
  return (s.match(NUM_RE) ?? []).map(normNumber).filter((x) => x.length > 0);
}

function wordSet(s: string): Set<string> {
  return new Set(
    s
      .split(/[^A-Za-z0-9+#.\-]+/)
      .map((w) => w.toLowerCase().replace(/[.\-]+$/g, ''))
      .filter(Boolean),
  );
}

function suspiciousWords(text: string, known: Set<string>): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    if (/^\s*(dear|hello|hi)\b/i.test(line)) continue;
    CAP_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CAP_RE.exec(line))) {
      const before = line.slice(0, m.index).trimEnd();
      if (!before || /[.!?:\-•*]$/.test(before)) continue; // sentence or bullet start
      const w = m[0].toLowerCase().replace(/[.\-]+$/g, '');
      if (STOP.has(w) || known.has(w)) continue;
      out.push(m[0]);
    }
  }
  return [...new Set(out)];
}

export function buildDraft(profile: Profile, job: JobContext, input: DraftInput): { doc: ResumeDoc; errors: string[]; checks: Check[] } {
  const errors: string[] = [];
  const checks: Check[] = [];
  const byId = <T extends { id?: string }>(arr: T[], id: string) => arr.find((x) => x.id === id);

  const doc: ResumeDoc = {
    name: profile.basics.name,
    headline: input.headline ?? profile.basics.headline,
    contact: [profile.basics.email, profile.basics.phone, profile.basics.location, ...profile.basics.links.map((l) => l.url)].filter(Boolean),
    summary: input.summary ?? profile.basics.summary,
    skills: input.skills ?? profile.skills,
    experience: [],
    projects: [],
    education: [],
    achievements: [],
    publications: [],
  };

  for (const e of input.experience) {
    const src = byId(profile.experience, e.profile_id);
    if (!src) {
      errors.push(`Unknown experience id "${e.profile_id}". Valid ids: ${profile.experience.map((x) => x.id).join(', ') || '(none)'}.`);
      continue;
    }
    doc.experience.push({
      title: src.title,
      company: src.company,
      location: src.location,
      start: src.start,
      end: src.end,
      bullets: e.bullets.length ? e.bullets : src.bullets,
    });
  }
  for (const p of input.projects) {
    const src = byId(profile.projects, p.profile_id);
    if (!src) {
      errors.push(`Unknown project id "${p.profile_id}". Valid ids: ${profile.projects.map((x) => x.id).join(', ') || '(none)'}.`);
      continue;
    }
    doc.projects.push({ name: src.name, link: src.link, start: src.start, end: src.end, bullets: p.bullets.length ? p.bullets : src.bullets });
  }
  for (const id of input.education) {
    const src = byId(profile.education, id);
    if (!src) errors.push(`Unknown education id "${id}". Valid ids: ${profile.education.map((x) => x.id).join(', ') || '(none)'}.`);
    else doc.education.push({ degree: src.degree, school: src.school, start: src.start, end: src.end, detail: src.detail });
  }
  for (const id of input.achievements) {
    const src = byId(profile.achievements, id);
    if (!src) errors.push(`Unknown achievement id "${id}". Valid ids: ${profile.achievements.map((x) => x.id).join(', ') || '(none)'}.`);
    else doc.achievements.push(src.text); // always word for word
  }
  for (const id of input.publications) {
    const src = byId(profile.publications, id);
    if (!src) errors.push(`Unknown publication id "${id}". Valid ids: ${profile.publications.map((x) => x.id).join(', ') || '(none)'}.`);
    else doc.publications.push(src.citation); // always word for word
  }

  // ---- fact checks ----
  const corpus = `${profileText(profile)}\n${job.title}\n${job.company}\n${job.description}`;
  const knownNums = new Set(numbersIn(corpus));
  const knownWords = wordSet(corpus);
  const profLower = profileText(profile).toLowerCase();

  const scan = (where: string, text: string) => {
    if (!text) return;
    for (const n of new Set(numbersIn(text))) {
      if (!knownNums.has(n)) checks.push({ where, text: n, issue: 'This number is not in your profile or the posting.' });
    }
    for (const w of suspiciousWords(text, knownWords)) {
      checks.push({ where, text: w, issue: 'This name or term is not in your profile or the posting.' });
    }
  };

  scan('Summary', doc.summary === profile.basics.summary ? '' : doc.summary);
  scan('Headline', doc.headline === profile.basics.headline ? '' : doc.headline);
  for (const e of doc.experience) e.bullets.forEach((b, i) => scan(`${e.company} · bullet ${i + 1}`, b));
  for (const p of doc.projects) p.bullets.forEach((b, i) => scan(`${p.name} · bullet ${i + 1}`, b));
  scan('Cover letter', input.cover_letter);
  for (const sk of doc.skills) {
    if (!profLower.includes(sk.toLowerCase())) checks.push({ where: 'Skills', text: sk, issue: 'This skill is not in your profile.' });
  }
  return { doc, errors, checks: checks.slice(0, 60) };
}
