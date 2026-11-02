// Reads "years of experience" requirements out of a posting's text.
// Pure and dependency-free so it can run on write (ingest) and when backfilling old rows.

export interface YearsAsked {
  min: number | null;
  max: number | null;
}

const NEAR = /experience|exp\b|background|professional|industry|hands[- ]on|relevant|working|worked|track record|expertise|proven|minimum|at least|required|qualification/;
const NOT_REQUIREMENT = /years? ago|years? old|year[- ]over[- ]year|years? of age|per year|a year\b|\/\s*year|years? since|since \d{4}|in business|founded|established|for over \d+ years,? (?:we|our)|years? (?:in a row|running)|anniversary|year(?:s)? (?:of )?growth/;

const RANGE = /(\d{1,2})\s*\+?\s*(?:-|–|—|to)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/g;
const SINGLE = /(\d{1,2})\s*(\+)?\s*(?:years?|yrs?)\b/g;
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const WORD_SINGLE = /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s*(\+)?\s*(?:years?|yrs?)\b/g;
const FRESHER = /\b(fresher|freshers|no (?:prior |previous )?(?:work )?experience (?:is )?(?:required|needed|necessary)|entry[- ]level|new grad(?:uate)?s?|recent graduates?)\b/;

/** Returns the highest lower bound found near the word "experience", with its upper bound if it was a range. */
export function extractYears(raw: string | null | undefined): YearsAsked {
  const text = (raw ?? '').toLowerCase().replace(/\s+/g, ' ');
  if (!text) return { min: null, max: null };

  const found: { min: number; max: number | null; at: number }[] = [];
  const ok = (start: number, end: number) => {
    const ctx = text.slice(Math.max(0, start - 70), Math.min(text.length, end + 70));
    return NEAR.test(ctx) && !NOT_REQUIREMENT.test(text.slice(Math.max(0, start - 15), end + 20));
  };

  const taken: [number, number][] = [];
  for (const m of text.matchAll(RANGE)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (b < a || b > 40 || !ok(start, end)) continue;
    found.push({ min: a, max: b, at: start });
    taken.push([start, end]);
  }
  const inRange = (i: number) => taken.some(([s, e]) => i >= s && i < e);
  for (const m of text.matchAll(SINGLE)) {
    const start = m.index ?? 0;
    if (inRange(start)) continue;
    const n = Number(m[1]);
    if (n > 40 || !ok(start, start + m[0].length)) continue;
    found.push({ min: n, max: null, at: start });
  }
  for (const m of text.matchAll(WORD_SINGLE)) {
    const start = m.index ?? 0;
    if (!ok(start, start + m[0].length)) continue;
    found.push({ min: WORDS[m[1]], max: null, at: start });
  }

  if (!found.length) {
    return FRESHER.test(text) ? { min: 0, max: null } : { min: null, max: null };
  }
  found.sort((x, y) => y.min - x.min || x.at - y.at);
  const best = found[0];
  return { min: best.min, max: best.max };
}

/** "3–5 yrs", "5+ yrs", "Entry", or null. */
export function yearsLabel(min: number | null | undefined, max: number | null | undefined): string | null {
  if (min == null) return null;
  if (max != null && max > min) return `${min}–${max} yrs`;
  if (min === 0) return 'No experience needed';
  return `${min}+ yrs`;
}

/** LinkedIn's experience level codes (the f_E search parameter). */
export const LINKEDIN_LEVELS = [
  { code: 1, key: 'internship', label: 'Internship' },
  { code: 2, key: 'entry', label: 'Entry level' },
  { code: 3, key: 'associate', label: 'Associate' },
  { code: 4, key: 'mid_senior', label: 'Mid-Senior' },
  { code: 5, key: 'director', label: 'Director' },
  { code: 6, key: 'executive', label: 'Executive' },
] as const;
