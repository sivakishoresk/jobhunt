// Fits a document onto whole pages: exactly one page, or exactly two with the second one filled.
// Pure: the caller supplies a measure() function (the browser lays the blocks out at a given density
// and reports their heights), so the same logic runs in the page, the editor preview and the unit tests.
// Nothing here knows what a resume contains: it only sees blocks with heights.

export type Paper = 'a4' | 'letter';
export const PAPERS: Record<Paper, { label: string; w: number; h: number }> = {
  a4: { label: 'A4', w: 210, h: 297 },
  letter: { label: 'US Letter', w: 215.9, h: 279.4 },
};
export const MM = 96 / 25.4; // CSS px per mm

/** How tightly the text is set. fs in pt, lh unitless, gap scales every vertical space, margin in mm. */
export interface Density {
  fs: number;
  lh: number;
  gap: number;
  margin: number;
}
/** The limits. Text never gets smaller or closer to the paper edge than TIGHT, however long the document is. */
export const ROOMY: Density = { fs: 11.5, lh: 1.45, gap: 1.35, margin: 18 };
export const TIGHT: Density = { fs: 9.5, lh: 1.2, gap: 0.55, margin: 11.5 };

/** t = 0 is the roomiest setting, t = 1 the tightest. */
export function densityAt(t: number): Density {
  const k = Math.min(1, Math.max(0, t));
  const mix = (a: number, b: number) => a + (b - a) * k;
  return {
    fs: Math.round(mix(ROOMY.fs, TIGHT.fs) * 20) / 20,
    lh: Math.round(mix(ROOMY.lh, TIGHT.lh) * 1000) / 1000,
    gap: Math.round(mix(ROOMY.gap, TIGHT.gap) * 1000) / 1000,
    margin: Math.round(mix(ROOMY.margin, TIGHT.margin) * 10) / 10,
  };
}
export const linePx = (d: Density) => (d.fs * d.lh * 96) / 72;

export interface Item {
  id: string;
  /** Full height in px, including the space above it. */
  h: number;
  /** The part of h that is space above the block; dropped when the block starts a page. */
  lead: number;
  /** Must stay on the same page as the next block (a heading, or a job title before its first bullet). */
  keep?: boolean;
  /** How much spare space this block may take above it when a page is topped up (0 = none). */
  stretch?: number;
  /** Blocks that belong together (the bullets of one job). Used only when suggesting what to trim. */
  group?: string;
  trimmable?: boolean;
}
export interface Measure {
  /** Height available for content on one page, in px. */
  H: number;
  items: Item[];
}

const EPS = 0.5;

/** Splits blocks into pages, top to bottom, never separating a `keep` block from the one after it. */
export function paginate(items: Item[], H: number): number[][] {
  const pages: number[][] = [[]];
  let used = 0;
  let i = 0;
  while (i < items.length) {
    let j = i;
    while (j < items.length - 1 && items[j].keep) j++;
    let gh = 0;
    for (let k = i; k <= j; k++) gh += items[k].h;
    const cur = pages[pages.length - 1];
    if (cur.length === 0) used = gh - items[i].lead;
    else if (used + gh <= H + EPS) used += gh;
    else {
      pages.push([]);
      used = gh - items[i].lead;
    }
    for (let k = i; k <= j; k++) pages[pages.length - 1].push(k);
    i = j + 1;
  }
  return pages;
}

export function usedOn(items: Item[], page: number[]): number {
  if (page.length === 0) return 0;
  let s = -items[page[0]].lead;
  for (const k of page) s += items[k].h;
  return s;
}

/** Spare space on a page, shared out above headings and entries (never above the first block), up to a cap. */
const STRETCH_UNIT = 7; // px of extra space per unit of stretch weight, at most
export function topUp(items: Item[], page: number[], H: number): { extra: Map<number, number>; used: number } {
  const used = usedOn(items, page);
  const extra = new Map<number, number>();
  const slack = H - used;
  const pts = page.slice(1).filter((k) => (items[k].stretch ?? 0) > 0);
  const weight = pts.reduce((s, k) => s + (items[k].stretch ?? 0), 0);
  if (slack <= 1 || weight === 0) return { extra, used };
  const unit = Math.min(STRETCH_UNIT, slack / weight);
  let added = 0;
  for (const k of pts) {
    const e = Math.floor(unit * (items[k].stretch ?? 0) * 100) / 100;
    extra.set(k, e);
    added += e;
  }
  return { extra, used: used + added };
}

export type Target = 'auto' | 1 | 2;
export type Status = 'ok' | 'short' | 'over';
export interface FitOptions {
  target?: Target;
  /** A page counts as filled from this share upward. */
  full?: number;
  /** Roomiest setting to try (letters start at a normal size, they are not blown up to fill the page). */
  tMin?: number;
  /** false for documents that need not fill the page (a cover letter): no topping up, never "short". */
  fill?: boolean;
}
export interface Fit {
  t: number;
  density: Density;
  H: number;
  items: Item[];
  pages: number[][];
  /** Extra px above a block, by block index. */
  extra: Map<number, number>;
  /** How full each page is, 0..1. */
  fills: number[];
  status: Status;
  /** over: lines beyond the allowed pages at the tightest setting. */
  overLines: number;
  /** short: lines that would fill the last page. */
  shortLines: number;
  /** Lines to cut so everything fits one page at the tightest setting; 0 when it already does. */
  cutForOne: number;
}

/**
 * Chooses the roomiest density at which the document takes the wanted number of pages.
 * auto: one page if it fits at any allowed density, otherwise two. Never more than two without saying so.
 */
export function fit(measure: (d: Density) => Measure, opts: FitOptions = {}): Fit {
  const target = opts.target ?? 'auto';
  const full = opts.full ?? 0.9;
  const tMin = opts.tMin ?? 0;
  const fill = opts.fill ?? true;
  const cache = new Map<number, { t: number; m: Measure; pages: number[][] }>();
  const at = (t: number) => {
    let r = cache.get(t);
    if (!r) {
      const m = measure(densityAt(t));
      r = { t, m, pages: paginate(m.items, m.H) };
      cache.set(t, r);
    }
    return r;
  };
  /** The roomiest t whose page count is at most n, or null when even the tightest is longer. */
  const roomiest = (n: number) => {
    if (at(tMin).pages.length <= n) return at(tMin);
    if (at(1).pages.length > n) return null;
    let lo = tMin;
    let hi = 1;
    for (let i = 0; i < 7; i++) {
      const mid = Math.round(((lo + hi) / 2) * 1000) / 1000;
      if (at(mid).pages.length <= n) hi = mid;
      else lo = mid;
    }
    return at(hi);
  };

  const tight = at(1);
  const tightLine = linePx(densityAt(1));
  const over1 = usedOn(tight.m.items, tight.m.items.map((_, k) => k)) - tight.m.H;
  const cutForOne = over1 > EPS ? Math.max(1, Math.ceil(over1 / tightLine)) : 0;

  const want = target === 'auto' ? 2 : target;
  let pick = target === 2 ? null : roomiest(1);
  if (!pick && want === 2) pick = roomiest(2);
  const fits = !!pick;
  if (!pick) pick = tight;

  const { m, pages, t } = pick;
  const density = densityAt(t);
  const extra = new Map<number, number>();
  const fills: number[] = [];
  for (const p of pages) {
    const r = fill ? topUp(m.items, p, m.H) : { extra: new Map<number, number>(), used: usedOn(m.items, p) };
    r.extra.forEach((v, k) => extra.set(k, v));
    fills.push(Math.min(1, Math.max(0, r.used / m.H)));
  }

  let status: Status = 'ok';
  let overLines = 0;
  let shortLines = 0;
  if (!fits) {
    status = 'over';
    const beyond = pages.slice(want).reduce((s, p) => s + usedOn(m.items, p), 0);
    overLines = Math.max(1, Math.ceil(beyond / tightLine));
  } else if (fill && fills[fills.length - 1] < full) {
    status = 'short';
    shortLines = Math.max(1, Math.round(((1 - fills[fills.length - 1]) * m.H) / linePx(density)));
  }
  return { t, density, H: m.H, items: m.items, pages, extra, fills, status, overLines, shortLines, cutForOne };
}

/**
 * What to leave out so the document fits one page at the tightest setting, taking as little as possible:
 * one bullet at a time from whichever group still has the most (the later group on a tie), last bullet first,
 * and never a group's only bullet. Returns block ids, or null when trimming bullets alone cannot get there.
 * It only suggests. Nothing is removed unless the person asks.
 */
export function suggestTrim(m: Measure): string[] | null {
  const alive = m.items.map(() => true);
  const total = () => {
    const first = alive.indexOf(true);
    if (first < 0) return 0;
    let s = -m.items[first].lead;
    m.items.forEach((it, k) => {
      if (alive[k]) s += it.h;
    });
    return s;
  };
  const out: string[] = [];
  while (total() > m.H + EPS) {
    const groups = new Map<string, number[]>();
    m.items.forEach((it, k) => {
      if (!alive[k] || !it.trimmable || !it.group) return;
      const g = groups.get(it.group) ?? [];
      g.push(k);
      groups.set(it.group, g);
    });
    let best: number[] | null = null;
    for (const g of groups.values()) if (g.length > 1 && (!best || g.length >= best.length)) best = g;
    if (!best) return null;
    const k = best[best.length - 1];
    alive[k] = false;
    out.push(m.items[k].id);
  }
  return out;
}
