import { z } from 'zod';
import type { Profile } from './profile';
import { factScanner, type Check, type JobContext } from './facts';
import { OutreachInputSchema } from './outreach';
import { SECTION_KEYS, layoutOf, type Section } from './layout';

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
  /** Order and headings of the sections. Missing on drafts saved before this existed (they print in the usual order). */
  layout?: Section[];
}

export type { Check, JobContext } from './facts';

export const DraftInputSchema = z.object({
  job_id: z.string().min(1),
  application_id: z.string().optional(),
  headline: z.string().optional(),
  summary: z.string().optional(),
  skills: z.array(z.string()).optional(),
  experience: z.array(z.object({ profile_id: z.string(), bullets: z.array(z.string()).default([]) })).default([]),
  projects: z.array(z.object({ profile_id: z.string(), bullets: z.array(z.string()).default([]) })).default([]),
  education: z.array(z.string()).default([]),
  achievements: z.array(z.string()).default([]).describe('Achievement ids from the profile (ach-1, ...): awards, certifications, ranks. Copied word for word.'),
  publications: z.array(z.string()).default([]),
  sections: z
    .array(z.object({ key: z.enum(SECTION_KEYS), title: z.string().max(40).optional() }))
    .max(SECTION_KEYS.length)
    .optional()
    .describe('Order and headings of the resume sections, chosen to suit this role: for example experience before skills for a management role, projects first for a new graduate, or {key:"achievements", title:"Certifications & Awards"}. Sections you leave out follow in the usual order; a section with nothing in it is not printed.'),
  cover_letter: z.string().default(''),
  linkedin: OutreachInputSchema.optional().describe('Optional LinkedIn messages for this job, saved next to the application. See save_outreach for how to write them.'),
  gaps: z.array(z.string()).default([]),
});
export type DraftInput = z.infer<typeof DraftInputSchema>;

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
    ...(input.sections?.length ? { layout: layoutOf(input.sections) } : {}),
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
  const scanner = factScanner(profile, job);
  const scan = (where: string, text: string) => {
    checks.push(...scanner(where, text));
  };
  const profLower = JSON.stringify(profile).toLowerCase();

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
