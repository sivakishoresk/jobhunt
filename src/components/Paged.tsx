'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { ResumeDoc } from '@/lib/drafts';
import { MM, PAPERS, densityAt, fit, suggestTrim, type Density, type Fit, type Item, type Measure, type Paper, type Target } from '@/lib/pagefit';
import { letterBlocks, resumeBlocks, type Block } from './sheets';

// Lays a document out on real pages. The paper size and margins are ours, not the print dialog's:
// each page is a box of exactly the paper size, and the text density is chosen by measuring, so the
// result is one page, or two with the second one filled, or a plain statement of how far off it is.

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* private mode: the choice just lasts for this visit */
  }
};
/** Letter where it is the everyday paper, A4 everywhere else. Only a starting point; the person can switch. */
function localPaper(): Paper {
  const region = (typeof navigator !== 'undefined' ? navigator.language : '').split('-')[1]?.toUpperCase();
  return region && ['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE'].includes(region) ? 'letter' : 'a4';
}

// A sheet is a hair shorter than the paper, or rounding makes the browser add a blank page after it.
const SHY = 0.4;
const vars = (d: Density) => ({ '--fs': d.fs, '--lh': d.lh, '--gap': d.gap }) as CSSProperties;

function Run({ blocks, idx, extra, first }: { blocks: Block[]; idx: number[]; extra?: Map<number, number>; first?: number }) {
  const out: ReactNode[] = [];
  let run: ReactNode[] = [];
  const flush = () => {
    if (run.length) out.push(<ul key={`u${out.length}`}>{run}</ul>);
    run = [];
  };
  for (const k of idx) {
    const b = blocks[k];
    const e = extra?.get(k);
    const props = { 'data-bid': b.id, className: `blk b-${b.kind}${k === first ? ' first' : ''}`, style: e ? { marginTop: e } : undefined };
    if (b.kind === 'bullet') run.push(<li key={b.id} {...props}>{b.node}</li>);
    else {
      flush();
      out.push(<div key={b.id} {...props}>{b.node}</div>);
    }
  }
  flush();
  return <>{out}</>;
}

interface Props {
  blocks: Block[];
  /** Changes whenever the content does. */
  sig: string;
  kind: 'resume' | 'letter';
  label: string;
  /** The print view: sets the paper for the browser and shows the print button. */
  printable?: boolean;
  autoPrint?: boolean;
  /** Where "left out for this export" is remembered (per application). */
  storeKey?: string;
  /** Offers the server-made PDF of this application's document. */
  pdf?: { id: string; doc: 'resume' | 'cover' };
  children?: ReactNode;
}

export function Paged({ blocks: all, sig: contentSig, kind, label, printable, autoPrint, storeKey, pdf, children }: Props) {
  const [paper, setPaper] = useState<Paper>('a4');
  const [target, setTarget] = useState<Target>('auto');
  const [hidden, setHidden] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [fonts, setFonts] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [note, setNote] = useState('');
  const [making, setMaking] = useState(false);
  const [layout, setLayout] = useState<(Fit & { sig: string }) | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const printed = useRef(false);
  const trimKey = storeKey ? `jh.trim.${storeKey}` : null;

  useEffect(() => {
    const p = read('jh.paper');
    setPaper(p === 'a4' || p === 'letter' ? p : localPaper());
    const t = read('jh.pages');
    if (kind === 'resume') setTarget(t === '1' ? 1 : t === '2' ? 2 : 'auto');
    if (trimKey) {
      try {
        const h = JSON.parse(read(trimKey) ?? '[]');
        if (Array.isArray(h)) setHidden(h.filter((x) => typeof x === 'string'));
      } catch {
        /* ignore a damaged entry */
      }
    }
    setLoaded(true);
    let live = true;
    const tick = () => live && setFonts((n) => n + 1);
    document.fonts?.ready.then(tick);
    document.fonts?.addEventListener?.('loadingdone', tick);
    window.addEventListener('afterprint', tick); // measure again once the page is back on screen
    return () => {
      live = false;
      document.fonts?.removeEventListener?.('loadingdone', tick);
      window.removeEventListener('afterprint', tick);
    };
  }, [kind, trimKey]);

  const blocks = useMemo(() => (hidden.length ? all.filter((b) => !(b.trimmable && b.text && hidden.includes(b.text))) : all), [all, hidden]);
  const left = useMemo(() => all.filter((b) => b.trimmable && b.text && hidden.includes(b.text)), [all, hidden]);
  const size = PAPERS[paper];
  // What the layout depends on. Fonts arriving only trigger a fresh measurement: a layout already on
  // screen stays in use meanwhile, so a font that finishes loading mid-print cannot unpaginate the document.
  const sig = `${contentSig}|${paper}|${target}|${hidden.join('\u0001')}`;

  /** Lays every block out at one density, off screen at the true page width, and reads the heights. */
  const measure = useCallback(
    (d: Density): Measure => {
      const el = ruler.current!;
      el.style.width = `${size.w - 2 * d.margin}mm`;
      el.style.setProperty('--fs', String(d.fs));
      el.style.setProperty('--lh', String(d.lh));
      el.style.setProperty('--gap', String(d.gap));
      const nodes = Array.from(el.querySelectorAll<HTMLElement>('[data-bid]'));
      const items: Item[] = nodes.map((n, i) => {
        const b = blocks[i];
        return { id: b.id, h: n.getBoundingClientRect().height, lead: parseFloat(getComputedStyle(n).paddingTop) || 0, keep: b.keep, stretch: b.stretch, group: b.group, trimmable: b.trimmable };
      });
      // One pixel under the true height, so rounding can never push a line onto another sheet.
      return { H: (size.h - 2 * d.margin) * MM - 1, items };
    },
    [blocks, size.w, size.h],
  );

  useLayoutEffect(() => {
    const el = ruler.current;
    if (!el || el.offsetWidth === 0) return; // hidden (for example while printing): keep the last layout
    const r = fit(measure, kind === 'letter' ? { target: 1, fill: false, tMin: 0.25 } : { target });
    setLayout({ ...r, sig });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, measure, fonts]);

  useEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setZoom(Math.min(1, el.clientWidth / (size.w * MM))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [size.w]);

  const ready = loaded && fonts > 0 && layout?.sig === sig;
  useEffect(() => {
    if (!autoPrint || !ready || printed.current || layout?.status !== 'ok') return;
    printed.current = true;
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [autoPrint, ready, layout?.status]);

  const fresh = layout && layout.sig === sig ? layout : null;
  const density = fresh?.density ?? layout?.density ?? densityAt(0.25);
  const pages = fresh ? fresh.pages : [blocks.map((_, k) => k)];
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const n = fresh?.pages.length ?? 1;
  const last = fresh ? fresh.fills[fresh.fills.length - 1] : 0;
  const lines = (k: number) => `${k} line${k === 1 ? '' : 's'}`;

  let message = 'Measuring…';
  if (fresh && kind === 'letter') message = fresh.status === 'ok' ? '1 page' : `About ${lines(fresh.overLines)} too long for one page, even at the smallest text size.`;
  else if (fresh) {
    if (fresh.status === 'ok') message = n === 1 ? `1 page, ${pct(last)} full` : `${n} pages, the last one ${pct(last)} full`;
    else if (fresh.status === 'over') message = `About ${lines(fresh.overLines)} too long for ${target === 1 ? '1 page' : '2 pages'}, even at the smallest text size (${density.fs}pt).`;
    else if (n === 1) message = `1 page, only ${pct(last)} full. About ${lines(fresh.shortLines)} more would fill it.`;
    else message = `${n} pages, but the last one is only ${pct(last)} full. Cut about ${lines(fresh.cutForOne)} to fit 1 page, or add about ${lines(fresh.shortLines)} to fill it.`;
  }
  const canTrim = kind === 'resume' && !!fresh && fresh.cutForOne > 0 && (fresh.status !== 'ok' || n > 1);

  const pick = (p: Paper) => {
    setPaper(p);
    write('jh.paper', p);
  };
  const want = (t: Target) => {
    setTarget(t);
    write('jh.pages', t === 'auto' ? null : String(t));
  };
  const hide = (texts: string[]) => {
    setHidden(texts);
    if (trimKey) write(trimKey, texts.length ? JSON.stringify(texts) : null);
  };
  /** The server opens this same view in its own Chromium and sends back the file: no print dialog involved. */
  const download = async () => {
    if (!pdf || making) return;
    setMaking(true);
    setNote('');
    try {
      const r = await fetch(`/api/applications/${pdf.id}/pdf`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ doc: pdf.doc, paper, pages: String(target), hidden }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `The server answered ${r.status}.`);
      const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? `${pdf.doc}.pdf`;
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setNote(`Could not make the PDF on the server: ${e instanceof Error ? e.message : String(e)}${printable ? ' You can still use Print or save as PDF.' : ' The print view can still save it as a PDF.'}`);
    } finally {
      setMaking(false);
    }
  };
  const trim = () => {
    const ids = suggestTrim(measure(densityAt(1)));
    if (!ids) return setNote('Leaving out bullets is not enough to reach one page: every entry is already down to one. Shorten the text, or use two pages.');
    setNote('');
    const texts = ids.map((id) => blocks.find((b) => b.id === id)?.text).filter((x): x is string => !!x);
    hide([...hidden, ...texts]);
    want(1);
  };

  return (
    <div className="paged" ref={root} data-fit={ready ? fresh?.status : 'pending'} data-pages={n}>
      {printable && <style>{`@page { size: ${size.w}mm ${size.h}mm; margin: 0; }`}</style>}
      <div className="fitbar noprint">
        <div className="fitrow">
          {pdf && (
            <button className="btn primary" onClick={download} disabled={!ready || making}>
              {making ? 'Making the PDF…' : 'Download PDF'}
            </button>
          )}
          {printable && (
            <button className={pdf ? 'btn' : 'btn primary'} onClick={() => window.print()} disabled={!ready}>
              Print or save as PDF
            </button>
          )}
          <label className="fitsel">
            Paper
            <select value={paper} onChange={(e) => pick(e.target.value as Paper)}>
              <option value="a4">A4</option>
              <option value="letter">US Letter</option>
            </select>
          </label>
          {kind === 'resume' && (
            <label className="fitsel">
              Length
              <select value={String(target)} onChange={(e) => want(e.target.value === 'auto' ? 'auto' : e.target.value === '1' ? 1 : 2)}>
                <option value="auto">Auto</option>
                <option value="1">1 page</option>
                <option value="2">2 pages</option>
              </select>
            </label>
          )}
          {children}
        </div>
        <p className={`fitmsg ${fresh ? fresh.status : ''}`} role="status">
          {message}
          {fresh && <span className="fitdetail"> ({density.fs}pt text, {density.margin}mm margins)</span>}{' '}
          {canTrim && (
            <button className="btn small" onClick={trim}>
              Suggest what to leave out for 1 page
            </button>
          )}
        </p>
        {note && <p className="fitmsg over">{note}</p>}
        {left.length > 0 && (
          <div className="fitleft">
            <strong>Left out of this export ({left.length}).</strong> Your saved resume is unchanged.{' '}
            <button className="btn small" onClick={() => hide([])}>
              Put all back
            </button>
            <ul>
              {left.map((b) => (
                <li key={b.id}>
                  {b.text}{' '}
                  <button className="linkbtn" onClick={() => hide(hidden.filter((t) => t !== b.text))}>
                    put back
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {printable && fresh && fresh.status !== 'ok' && autoPrint && <p className="hint">The print dialog was not opened automatically because the page check above did not pass. You can still print.</p>}
      </div>

      <div className="doc doc-ruler" ref={ruler} aria-hidden="true">
        <Run blocks={blocks} idx={blocks.map((_, k) => k)} />
      </div>

      <div className="pages" style={{ zoom }}>
        {pages.map((idx, p) => (
          <div
            key={p}
            className={`sheet doc${kind === 'letter' ? ' letter' : ''}`}
            aria-label={pages.length > 1 ? `${label}, page ${p + 1} of ${pages.length}` : label}
            style={{ ...vars(density), width: `${size.w}mm`, [fresh ? 'height' : 'minHeight']: `${size.h - SHY}mm`, padding: `${density.margin}mm` }}
          >
            <Run blocks={blocks} idx={idx} extra={fresh?.extra} first={idx[0]} />
          </div>
        ))}
      </div>
    </div>
  );
}

type Shared = Pick<Props, 'printable' | 'autoPrint' | 'storeKey' | 'pdf' | 'children'>;

export function ResumeSheet({ doc, ...rest }: { doc: ResumeDoc } & Shared) {
  const blocks = useMemo(() => resumeBlocks(doc), [doc]);
  const sig = useMemo(() => JSON.stringify(doc), [doc]);
  return <Paged blocks={blocks} sig={sig} kind="resume" label="Resume preview" {...rest} />;
}

export function LetterSheet({ name, contact, date, company, body, ...rest }: { name: string; contact: string[]; date: string; company: string; body: string } & Shared) {
  const sig = JSON.stringify([name, contact, date, company, body]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const blocks = useMemo(() => letterBlocks({ name, contact, date, company, body }), [sig]);
  return <Paged blocks={blocks} sig={sig} kind="letter" label="Cover letter preview" {...rest} />;
}
