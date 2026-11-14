// Run: node --experimental-strip-types scripts/test-pagefit.mjs
// The page fitter with a stand-in for the browser: text wraps by character count, so the rules can be
// checked for any shape of document (a new graduate's half page, a manager's long history, a letter).
import { MM, PAPERS, TIGHT, densityAt, fit, linePx, paginate, suggestTrim, topUp, usedOn } from '../src/lib/pagefit.ts';

let bad = 0;
const check = (name, cond, extra = '') => {
  if (!cond) bad++;
  console.log(cond ? '  ✓' : '  ✗', name, cond ? '' : extra);
};

/** A fake layout engine: `chars` of text at this density, on this paper. */
const measurer = (blocks, paper = 'a4') => (d) => {
  const width = (PAPERS[paper].w - 2 * d.margin) * MM;
  const perLine = Math.floor(width / (d.fs * 0.62));
  return {
    H: (PAPERS[paper].h - 2 * d.margin) * MM - 1,
    items: blocks.map((b, i) => {
      const lead = (b.lead ?? 0) * d.gap;
      return { id: b.id ?? `b${i}`, h: Math.ceil(b.chars / perLine) * linePx(d) + lead, lead, keep: b.keep, stretch: b.stretch, group: b.group, trimmable: b.trimmable };
    }),
  };
};
/** n sections, each a heading, then entries with bullets. Not tied to any profession. */
const doc = (sections, entries, bullets, chars = 170) => {
  const out = [{ id: 'head', chars: 200 }];
  for (let s = 0; s < sections; s++) {
    out.push({ id: `h${s}`, chars: 20, lead: 12, keep: true, stretch: 2 });
    for (let e = 0; e < entries; e++) {
      out.push({ id: `s${s}e${e}`, chars: 60, lead: 6, keep: true, stretch: e ? 1 : 0 });
      for (let b = 0; b < bullets; b++) out.push({ id: `s${s}e${e}b${b}`, chars, lead: 2, group: `s${s}e${e}`, trimmable: true, stretch: 0.15 });
    }
  }
  return out;
};

console.log('paginate');
{
  const items = [
    { id: 'a', h: 60, lead: 0 },
    { id: 'h', h: 30, lead: 10, keep: true },
    { id: 'e', h: 20, lead: 5, keep: true },
    { id: 'b1', h: 30, lead: 2 },
    { id: 'b2', h: 30, lead: 2 },
  ];
  const p = paginate(items, 95);
  check('a heading and an entry title move with the first bullet', JSON.stringify(p) === '[[0],[1,2,3],[4]]', JSON.stringify(p));
  check('space above the first block of a page is not counted', usedOn(items, p[1]) === 70, String(usedOn(items, p[1])));
  check('one block taller than a page still gets a page', paginate([{ id: 'x', h: 500, lead: 0 }], 100).length === 1);
}

console.log('topUp');
{
  const items = [
    { id: 'a', h: 100, lead: 0, stretch: 2 },
    { id: 'h', h: 30, lead: 10, stretch: 2 },
    { id: 'e', h: 20, lead: 5, stretch: 1 },
  ];
  const r = topUp(items, [0, 1, 2], 162);
  check('spare space is shared by weight and fills the page', Math.abs(r.used - 162) < 0.1 && r.extra.get(1) === 8 && r.extra.get(2) === 4, JSON.stringify([...r.extra]));
  check('nothing is added above the first block', !r.extra.has(0));
  const big = topUp(items, [0, 1, 2], 1000);
  check('gaps are capped, a thin page is not smeared out', big.extra.get(1) === 14 && big.used < 200);
}

console.log('fit');
for (const paper of ['a4', 'letter']) {
  for (const [name, blocks] of [
    ['short', doc(2, 1, 2)],
    ['about a page', doc(3, 2, 3)],
    ['a page and a half', doc(3, 3, 4)],
    ['two pages', doc(4, 3, 5)],
    ['far too long', doc(8, 4, 6)],
  ]) {
    const m = measurer(blocks, paper);
    const r = fit(m);
    const n = r.pages.length;
    check(`${paper}, ${name}: every block is placed exactly once`, r.pages.flat().join() === blocks.map((_, i) => i).join());
    check(`${paper}, ${name}: never smaller than the floor`, r.density.fs >= TIGHT.fs && r.density.margin >= TIGHT.margin && r.density.lh >= TIGHT.lh);
    check(`${paper}, ${name}: no page holds more than fits`, r.pages.every((p) => usedOn(r.items, p) <= r.H + 0.5) || r.status === 'over');
    check(`${paper}, ${name}: more than two pages is always reported`, n <= 2 || r.status === 'over', `${n} pages, ${r.status}`);
    check(`${paper}, ${name}: "ok" means a filled last page`, r.status !== 'ok' || r.fills[n - 1] >= 0.9, JSON.stringify(r.fills));
    console.log(`      -> ${n} page(s), ${r.status}, ${r.density.fs}pt, fills ${r.fills.map((f) => Math.round(f * 100) + '%').join(' ')}`);
  }
}
{
  const blocks = doc(3, 2, 3);
  const auto = fit(measurer(blocks));
  check('auto prefers one page when it fits', auto.pages.length === 1 && auto.status === 'ok', `${auto.pages.length} ${auto.status}`);
  const roomier = fit(measurer(doc(2, 2, 3)));
  check('a shorter document gets larger text, not empty space', roomier.density.fs > auto.density.fs, `${roomier.density.fs} vs ${auto.density.fs}`);
  const long = doc(4, 3, 5);
  const one = fit(measurer(long), { target: 1 });
  check('asking for one page of a two-page document is reported, not squeezed past the floor', one.status === 'over' && one.overLines > 0 && one.density.fs === TIGHT.fs);
  check('and says how many lines to cut', one.cutForOne > 0);
  const two = fit(measurer(doc(2, 1, 2)), { target: 2 });
  check('asking for two pages of a short document is reported as short', two.status === 'short' && two.pages.length === 1);
  const letter = fit(measurer([{ chars: 80 }, { chars: 30, lead: 11 }, { chars: 900, lead: 11 }, { chars: 700, lead: 11 }]), { target: 1, fill: false, tMin: 0.25 });
  check('a letter stays at normal size and is not called short', letter.status === 'ok' && letter.density.fs === densityAt(0.25).fs && letter.extra.size === 0);
}

console.log('suggestTrim');
{
  const blocks = doc(3, 3, 4);
  const m = measurer(blocks)(densityAt(1));
  const ids = suggestTrim(m);
  check('finds bullets to leave out', Array.isArray(ids) && ids.length > 0);
  const kept = blocks.filter((b) => !ids.includes(b.id));
  check('what is left fits one page', fit(measurer(kept), { target: 1 }).status !== 'over');
  check('only bullets are suggested', ids.every((id) => /b\d+$/.test(id)));
  const perGroup = {};
  kept.forEach((b) => b.group && (perGroup[b.group] = (perGroup[b.group] ?? 0) + 1));
  check('every entry keeps at least one bullet', Object.keys(perGroup).length === 9 && Object.values(perGroup).every((n) => n >= 1));
  check('takes last bullets first', ids.every((id) => !id.endsWith('b0')));
  check('says so when trimming cannot get there', suggestTrim(measurer(doc(12, 4, 1))(densityAt(1))) === null);
  check('suggests nothing when it already fits', suggestTrim(measurer(doc(2, 1, 2))(densityAt(1))).length === 0);
}

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
