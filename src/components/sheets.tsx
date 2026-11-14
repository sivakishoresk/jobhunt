import { Fragment, type ReactNode } from 'react';
import { layoutOf } from '@/lib/layout';
import type { ResumeDoc } from '@/lib/drafts';
import { renderBold } from '../lib/bold';

// A document is a flat list of blocks. The page fitter (lib/pagefit, components/Paged) measures them and
// decides which page each lands on, so nothing here assumes a section, a profession or a length.

export type BlockKind = 'head' | 'heading' | 'entry' | 'bullet' | 'para' | 'lpara';
export interface Block {
  id: string;
  kind: BlockKind;
  node: ReactNode;
  /** Stays on the same page as the next block. */
  keep?: boolean;
  /** Share of spare page space this block may take above it. */
  stretch?: number;
  /** Bullets of one entry or one list. */
  group?: string;
  trimmable?: boolean;
  /** Plain text, shown when the block is suggested for trimming. */
  text?: string;
}

const dates = (a: string, b: string) => [a, b].filter(Boolean).join(' – ');
const plain = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1');

export function resumeBlocks(doc: ResumeDoc): Block[] {
  const out: Block[] = [
    {
      id: 'head',
      kind: 'head',
      node: (
        <>
          <h1>{doc.name || 'Your name'}</h1>
          {doc.headline && <div className="headline">{renderBold(doc.headline)}</div>}
          {doc.contact.length > 0 && <div className="contact">{doc.contact.join('  |  ')}</div>}
        </>
      ),
    },
  ];
  const entry = (id: string, first: boolean, left: ReactNode, when: string, sub: string, bullets: string[]) => {
    out.push({
      id,
      kind: 'entry',
      keep: bullets.length > 0,
      stretch: first ? 0 : 1,
      node: (
        <>
          <div className="line">
            <strong>{left}</strong>
            <span className="when">{when}</span>
          </div>
          {sub && <div className="sub">{sub}</div>}
        </>
      ),
    });
    list(id, bullets);
  };
  const list = (group: string, items: string[]) =>
    items.forEach((b, k) =>
      // In a list of three or more, the last two travel together: a page never opens with one stray bullet.
      out.push({ id: `${group}.${k}`, kind: 'bullet', group, trimmable: true, stretch: 0.15, keep: items.length >= 3 && k === items.length - 2, text: plain(b), node: renderBold(b) }),
    );

  for (const sec of layoutOf(doc.layout)) {
    const start = out.length;
    out.push({ id: `h.${sec.key}`, kind: 'heading', keep: true, stretch: 2, node: <h2>{sec.title}</h2> });
    switch (sec.key) {
      case 'summary':
        if (doc.summary) out.push({ id: 'summary', kind: 'para', node: <p>{renderBold(doc.summary)}</p> });
        break;
      case 'skills':
        if (doc.skills.length > 0) out.push({ id: 'skills', kind: 'para', node: <p>{doc.skills.join(', ')}</p> });
        break;
      case 'experience':
        doc.experience.forEach((e, i) => entry(`experience.${i}`, i === 0, [e.title, e.company].filter(Boolean).join(', '), dates(e.start, e.end), e.location, e.bullets));
        break;
      case 'projects':
        doc.projects.forEach((p, i) => entry(`projects.${i}`, i === 0, p.name, dates(p.start, p.end), p.link, p.bullets));
        break;
      case 'education':
        doc.education.forEach((e, i) => entry(`education.${i}`, i === 0, [e.degree, e.school].filter(Boolean).join(', '), dates(e.start, e.end), e.detail, []));
        break;
      case 'achievements':
        list('achievements', doc.achievements ?? []);
        break;
      case 'publications':
        list('publications', doc.publications ?? []);
        break;
    }
    if (out.length === start + 1) out.pop(); // an empty section prints nothing, not even its heading
  }
  return out;
}

export function letterBlocks({ name, contact, date, company, body }: { name: string; contact: string[]; date: string; company: string; body: string }): Block[] {
  const paras = body.replace(/\r\n/g, '\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const out: Block[] = [
    {
      id: 'from',
      kind: 'lpara',
      node: (
        <p>
          <strong>{name}</strong>
          <br />
          <span className="contact">{contact.join('  |  ')}</span>
        </p>
      ),
    },
    { id: 'date', kind: 'lpara', node: <p>{date}</p> },
    { id: 'to', kind: 'lpara', keep: true, node: <p>Hiring team, {company}</p> },
  ];
  paras.forEach((p, i) =>
    out.push({
      id: `p.${i}`,
      kind: 'lpara',
      node: (
        <p>
          {p.split('\n').map((ln, k) => (
            <Fragment key={k}>
              {k > 0 && <br />}
              {renderBold(ln)}
            </Fragment>
          ))}
        </p>
      ),
    }),
  );
  return out;
}

export function letterDate(iso: string | null): string {
  return new Date(iso ?? Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
}
