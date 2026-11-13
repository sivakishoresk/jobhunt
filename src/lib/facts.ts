// Checks written text against what is known: every number and every capitalised name must come
// from the profile or the posting. Shared by resume drafts and LinkedIn messages.
import type { Profile } from './profile';

export interface Check {
  where: string;
  text: string;
  issue: string;
}

export interface JobContext {
  title: string;
  company: string;
  description: string;
}

const STOP = new Set(
  `dear hello hi hey sincerely regards best kind thanks thank you your yours hiring team manager recruiter monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december present current the and for with this that from have has our we i my linkedin`
    .split(' '),
);

/** "$1.2M", "1.2 million" and "12 lakh" style figures compare equal once reduced to a plain number. */
const UNITS: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, lakh: 1e5, lakhs: 1e5, lac: 1e5, cr: 1e7, crore: 1e7, crores: 1e7 };
const NUM_RE = /(?<![A-Za-z0-9.])[$₹€£]?(\d[\d,]*(?:\.\d+)?)\s?(%|x|k|mn|m|bn|b|cr|crores?|lakhs?|lac|thousand|million|billion)?(?![A-Za-z0-9])/gi;
const CAP_RE = /\b[A-Z][A-Za-z0-9+#.\-]{2,}\b/g;

/** Every figure in the text: as written, and reduced to a comparable form. */
export function numbersIn(s: string): { raw: string; norm: string }[] {
  const out: { raw: string; norm: string }[] = [];
  for (const m of s.matchAll(NUM_RE)) {
    const n = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    const unit = (m[2] ?? '').toLowerCase();
    const norm = unit === '%' || unit === 'x' ? `${n}${unit}` : String(UNITS[unit] ? Math.round(n * UNITS[unit] * 1000) / 1000 : n);
    out.push({ raw: m[0].trim(), norm });
  }
  return out;
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
    if (/^\s*(dear|hello|hi|hey)\b[^.!?]{0,40}$/i.test(line)) continue; // a greeting on its own line
    CAP_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CAP_RE.exec(line))) {
      const before = line.slice(0, m.index).trimEnd();
      if (!before || /[.!?:\-•*]$/.test(before)) continue; // sentence or bullet start
      const w = m[0].toLowerCase().replace(/[.\-]+$/g, '');
      if (STOP.has(w) || known.has(w)) continue;
      // "Go-to-market": known if each part is
      if (w.includes('-') && w.split('-').every((p) => !p || STOP.has(p) || known.has(p) || p.length < 3)) continue;
      out.push(m[0]);
    }
  }
  return [...new Set(out)];
}

/** Returns a function that lists what in a piece of text is not backed by the profile or the posting. */
export function factScanner(profile: Profile, job: JobContext): (where: string, text: string) => Check[] {
  const corpus = `${JSON.stringify(profile)}\n${job.title}\n${job.company}\n${job.description}`;
  const knownNums = new Set(numbersIn(corpus).map((x) => x.norm));
  const knownWords = wordSet(corpus);
  return (where, text) => {
    const checks: Check[] = [];
    if (!text) return checks;
    const seen = new Set<string>();
    for (const n of numbersIn(text)) {
      if (knownNums.has(n.norm) || seen.has(n.norm)) continue;
      seen.add(n.norm);
      checks.push({ where, text: n.raw, issue: 'This number is not in your profile or the posting.' });
    }
    for (const w of suspiciousWords(text, knownWords)) {
      checks.push({ where, text: w, issue: 'This name or term is not in your profile or the posting.' });
    }
    return checks;
  };
}
