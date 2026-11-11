import { z } from 'zod';
import { kvGet, kvSet, ukey } from './db';

const s = z.string().trim();
const sd = s.default('');

export const ExperienceSchema = z.object({
  id: z.string().optional(),
  title: s.min(1),
  company: s.min(1),
  location: sd,
  start: sd,
  end: sd,
  bullets: z.array(s).default([]),
});
export const ProjectSchema = z.object({
  id: z.string().optional(),
  name: s.min(1),
  link: sd,
  start: sd,
  end: sd,
  bullets: z.array(s).default([]),
});
export const EducationSchema = z.object({
  id: z.string().optional(),
  degree: s.min(1),
  school: s.min(1),
  start: sd,
  end: sd,
  detail: sd,
});
export const PublicationSchema = z.object({ id: z.string().optional(), citation: s.min(1) });
export const AchievementSchema = z.object({ id: z.string().optional(), text: s.min(1) });
export const BasicsSchema = z.object({
  name: sd,
  headline: sd,
  email: sd,
  phone: sd,
  location: sd,
  summary: sd,
  links: z.array(z.object({ label: sd, url: s.min(1) })).default([]),
});

/** What the user wants and can do. Scoring reads it; none of it goes on a resume. */
export const PreferencesSchema = z.object({
  yearsOverride: z.number().min(0).max(40).nullable().default(null).describe('Years of relevant experience to score with. Leave null to count from the experience dates.'),
  workAuthorization: sd.describe('Where you can work without sponsorship, e.g. "India citizen; needs sponsorship for the US".'),
  locations: z.array(s.min(1)).max(10).default([]).describe('Cities or countries that work for you.'),
  remoteOk: z.boolean().default(true),
  salaryFloor: sd.describe('Lowest pay worth taking, in the currency you think in, e.g. "INR 30 LPA" or "USD 150k".'),
  blockedCompanies: z.array(s.min(1)).max(50).default([]),
  avoidRoles: z.array(s.min(1)).max(20).default([]).describe('Kinds of role you do not want, e.g. "sales engineer".'),
  priorities: sd.describe('What you want from the next job, in a sentence or two. Used to judge growth and mission.'),
  baseRate: z.number().min(0.005).max(0.5).nullable().default(null).describe('Your own callback rate once you know it (0.04 = 4 in 100 applications). Null uses the default.'),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

export const ProfileSchema = z.object({
  basics: BasicsSchema.default(() => BasicsSchema.parse({})),
  skills: z.array(s).default([]),
  experience: z.array(ExperienceSchema).default([]),
  projects: z.array(ProjectSchema).default([]),
  education: z.array(EducationSchema).default([]),
  achievements: z.array(AchievementSchema).default([]),
  publications: z.array(PublicationSchema).default([]),
  jobTitles: z.array(s.min(1)).max(5).default([]),
  preferences: PreferencesSchema.default(() => PreferencesSchema.parse({})),
});
export type Profile = z.infer<typeof ProfileSchema>;

/**
 * Update shapes for basics and preferences: every field optional and NO defaults. The MCP library fills in
 * schema defaults before our code runs, so a defaulted schema would turn "headline only" into "everything blank".
 */
const BasicsPatchSchema = z.object({
  name: s.optional(),
  headline: s.optional(),
  email: s.optional(),
  phone: s.optional(),
  location: s.optional(),
  summary: s.optional(),
  links: z.array(z.object({ label: sd, url: s.min(1) })).optional(),
});
const PreferencesPatchSchema = z.object({
  yearsOverride: z.number().min(0).max(40).nullable().optional().describe('Years of relevant experience to score with. null counts from the experience dates.'),
  workAuthorization: s.optional().describe('Where you can work without sponsorship, e.g. "India citizen; needs sponsorship for the US".'),
  locations: z.array(s.min(1)).max(10).optional().describe('Cities or countries that work for you.'),
  remoteOk: z.boolean().optional(),
  salaryFloor: s.optional().describe('Lowest pay worth taking, e.g. "INR 30 LPA".'),
  blockedCompanies: z.array(s.min(1)).max(50).optional(),
  avoidRoles: z.array(s.min(1)).max(20).optional(),
  priorities: s.optional().describe('What the user wants from the next job, in a sentence or two.'),
  baseRate: z.number().min(0.005).max(0.5).nullable().optional().describe('Own callback rate, 0.04 = 4 in 100 applications. null uses the default.'),
});

export const ProfilePatchSchema = z.object({
  basics: BasicsPatchSchema.optional().describe('Merged field by field: send only the fields that change.'),
  skills: z.array(s).optional(),
  experience: z.array(ExperienceSchema).optional(),
  projects: z.array(ProjectSchema).optional(),
  education: z.array(EducationSchema).optional(),
  achievements: z.array(AchievementSchema).optional(),
  publications: z.array(PublicationSchema).optional(),
  jobTitles: z.array(s.min(1)).max(5).optional().describe('Up to 5 job titles that fit this profile, used to search for jobs.'),
  preferences: PreferencesPatchSchema.optional().describe('Scoring preferences. Merged field by field: only the fields you send change.'),
});

const PREFIX = { experience: 'exp', projects: 'proj', education: 'edu', achievements: 'ach', publications: 'pub' } as const;

function withIds<T extends { id?: string }>(items: T[], prefix: string): (T & { id: string })[] {
  const used = new Set(items.map((i) => i.id).filter(Boolean) as string[]);
  let n = 0;
  return items.map((it) => {
    if (it.id) return it as T & { id: string };
    do n++;
    while (used.has(`${prefix}-${n}`));
    used.add(`${prefix}-${n}`);
    return { ...it, id: `${prefix}-${n}` };
  });
}

export function assignIds(p: Profile): Profile {
  return {
    ...p,
    experience: withIds(p.experience, PREFIX.experience),
    projects: withIds(p.projects, PREFIX.projects),
    education: withIds(p.education, PREFIX.education),
    achievements: withIds(p.achievements, PREFIX.achievements),
    publications: withIds(p.publications, PREFIX.publications),
  };
}

export async function getProfile(uid: string): Promise<Profile> {
  const stored = await kvGet<unknown>(ukey(uid, 'profile'));
  const parsed = ProfileSchema.safeParse(stored ?? {});
  return assignIds(parsed.success ? parsed.data : ProfileSchema.parse({}));
}

export async function saveProfile(uid: string, patch: unknown): Promise<Profile> {
  const p = ProfilePatchSchema.parse(patch);
  const current = await getProfile(uid);
  const defined: Record<string, unknown> = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined));
  // basics and preferences merge field by field. Claude never sees email, phone or links, so a
  // basics update from Claude must not blank them; fields that are not sent keep their saved value.
  for (const k of ['basics', 'preferences'] as const) {
    if (p[k]) defined[k] = { ...current[k], ...Object.fromEntries(Object.entries(p[k] as Record<string, unknown>).filter(([, v]) => v !== undefined)) };
  }
  const next = assignIds(ProfileSchema.parse({ ...current, ...defined }));
  await kvSet(ukey(uid, 'profile'), next);
  return next;
}

/** Profile as Claude sees it: no email, phone or links. */
export function claudeView(p: Profile) {
  const { email: _e, phone: _p, links: _l, ...basics } = p.basics;
  return { ...p, basics };
}

export function profileText(p: Profile): string {
  return JSON.stringify(p);
}

export function profileIsEmpty(p: Profile): boolean {
  return !p.basics.name && !p.experience.length && !p.projects.length && !p.education.length && !p.skills.length;
}
