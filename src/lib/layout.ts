// Order and headings of resume sections. Pure: used by the page preview, the DOCX export and drafts.

export const SECTION_KEYS = ['summary', 'skills', 'experience', 'projects', 'education', 'achievements', 'publications'] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
export interface Section {
  key: SectionKey;
  title: string;
}

export const DEFAULT_TITLES: Record<SectionKey, string> = {
  summary: 'Summary',
  skills: 'Skills',
  experience: 'Experience',
  projects: 'Projects',
  education: 'Education',
  achievements: 'Scholastic Achievements',
  publications: 'Publications',
};

/** The sections to print, in order. Anything not listed follows in the usual order, so content never silently disappears. */
export function layoutOf(layout?: { key: string; title?: string }[] | null): Section[] {
  const out: Section[] = [];
  for (const s of layout ?? []) {
    const key = s.key as SectionKey;
    if (!SECTION_KEYS.includes(key) || out.some((x) => x.key === key)) continue;
    out.push({ key, title: (s.title ?? '').trim().slice(0, 40) || DEFAULT_TITLES[key] });
  }
  for (const key of SECTION_KEYS) if (!out.some((x) => x.key === key)) out.push({ key, title: DEFAULT_TITLES[key] });
  return out;
}
