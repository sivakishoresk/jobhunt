import { z } from 'zod';
import { kvGet, kvSet } from './db';

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

export const ProfileSchema = z.object({
  basics: BasicsSchema.default(() => BasicsSchema.parse({})),
  skills: z.array(s).default([]),
  experience: z.array(ExperienceSchema).default([]),
  projects: z.array(ProjectSchema).default([]),
  education: z.array(EducationSchema).default([]),
  achievements: z.array(AchievementSchema).default([]),
  publications: z.array(PublicationSchema).default([]),
  jobTitles: z.array(s.min(1)).max(5).default([]),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const ProfilePatchSchema = z.object({
  basics: BasicsSchema.optional(),
  skills: z.array(s).optional(),
  experience: z.array(ExperienceSchema).optional(),
  projects: z.array(ProjectSchema).optional(),
  education: z.array(EducationSchema).optional(),
  achievements: z.array(AchievementSchema).optional(),
  publications: z.array(PublicationSchema).optional(),
  jobTitles: z.array(s.min(1)).max(5).optional().describe('Up to 5 job titles that fit this profile, used to search for jobs.'),
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

export async function getProfile(): Promise<Profile> {
  const stored = await kvGet<unknown>('profile');
  const parsed = ProfileSchema.safeParse(stored ?? {});
  return assignIds(parsed.success ? parsed.data : ProfileSchema.parse({}));
}

export async function saveProfile(patch: unknown): Promise<Profile> {
  const p = ProfilePatchSchema.parse(patch);
  const current = await getProfile();
  const next = assignIds(ProfileSchema.parse({ ...current, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) }));
  await kvSet('profile', next);
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
