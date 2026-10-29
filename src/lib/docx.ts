import {
  AlignmentType,
  BorderStyle,
  Document,
  LevelFormat,
  Packer,
  Paragraph,
  TabStopType,
  TextRun,
} from 'docx';
import type { ResumeDoc } from './drafts';

const FONT = 'Cambria';
const PAGE_W = 11906; // A4 in twips
const MARGIN = 1080; // 0.75 in
const TEXT_W = PAGE_W - MARGIN * 2;

/** Splits "a **b** c" into runs, bolding the marked part. */
function runs(text: string, base: { size?: number; italics?: boolean; bold?: boolean } = {}): TextRun[] {
  const out: TextRun[] = [];
  const parts = text.split(/\*\*(.+?)\*\*/g);
  parts.forEach((p, i) => {
    if (p) out.push(new TextRun({ text: p, font: FONT, size: base.size ?? 21, italics: base.italics, bold: base.bold || i % 2 === 1 }));
  });
  return out.length ? out : [new TextRun({ text: '', font: FONT })];
}

const heading = (t: string) =>
  new Paragraph({
    spacing: { before: 200, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '888888', space: 1 } },
    children: [new TextRun({ text: t, bold: true, font: FONT, size: 22 })],
  });

/** Title/company on the left, dates flush right. */
const lineWithDates = (left: string, right: string, size = 21) =>
  new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: TEXT_W }],
    spacing: { before: 100 },
    children: [...runs(left, { bold: true, size }), new TextRun({ text: right ? `\t${right}` : '', font: FONT, size })],
  });

const bullet = (t: string) =>
  new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 30 }, children: runs(t) });

const dates = (a: string, b: string) => [a, b].filter(Boolean).join(' – ');

const numbering = {
  config: [
    {
      reference: 'bullets',
      levels: [
        {
          level: 0,
          format: LevelFormat.BULLET,
          text: '•',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 360, hanging: 240 } } },
        },
      ],
    },
  ],
};

function page(children: Paragraph[]) {
  return {
    properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
    children,
  };
}

export async function resumeDocx(r: ResumeDoc): Promise<Buffer> {
  const c: Paragraph[] = [];
  c.push(new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun({ text: r.name, bold: true, font: FONT, size: 36 })] }));
  if (r.headline) c.push(new Paragraph({ children: runs(r.headline, { size: 22 }) }));
  if (r.contact.length) c.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: r.contact.join('  |  '), font: FONT, size: 19, color: '444444' })] }));
  if (r.summary) {
    c.push(heading('Summary'));
    c.push(new Paragraph({ children: runs(r.summary) }));
  }
  if (r.skills.length) {
    c.push(heading('Skills'));
    c.push(new Paragraph({ children: runs(r.skills.join(', ')) }));
  }
  if (r.experience.length) {
    c.push(heading('Experience'));
    for (const e of r.experience) {
      c.push(lineWithDates(`${e.title}, ${e.company}`, dates(e.start, e.end)));
      if (e.location) c.push(new Paragraph({ children: runs(e.location, { italics: true, size: 19 }) }));
      e.bullets.forEach((b) => c.push(bullet(b)));
    }
  }
  if (r.projects.length) {
    c.push(heading('Projects'));
    for (const p of r.projects) {
      c.push(lineWithDates(p.name, dates(p.start, p.end)));
      if (p.link) c.push(new Paragraph({ children: runs(p.link, { size: 19 }) }));
      p.bullets.forEach((b) => c.push(bullet(b)));
    }
  }
  if (r.education.length) {
    c.push(heading('Education'));
    for (const e of r.education) {
      c.push(lineWithDates(`${e.degree}, ${e.school}`, dates(e.start, e.end)));
      if (e.detail) c.push(new Paragraph({ children: runs(e.detail, { size: 19 }) }));
    }
  }
  if (r.publications.length) {
    c.push(heading('Publications'));
    r.publications.forEach((p) => c.push(bullet(p)));
  }
  const doc = new Document({ numbering, creator: r.name, title: `${r.name} resume`, sections: [page(c)] });
  return Packer.toBuffer(doc);
}

export function letterParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export async function letterDocx(args: { name: string; contact: string[]; date: string; company: string; body: string }): Promise<Buffer> {
  const c: Paragraph[] = [];
  c.push(new Paragraph({ children: [new TextRun({ text: args.name, bold: true, font: FONT, size: 26 })] }));
  if (args.contact.length) c.push(new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: args.contact.join('  |  '), font: FONT, size: 19, color: '444444' })] }));
  c.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: args.date, font: FONT, size: 21 })] }));
  c.push(new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: `Hiring team, ${args.company}`, font: FONT, size: 21 })] }));
  for (const p of letterParagraphs(args.body)) {
    const lines = p.split('\n');
    c.push(
      new Paragraph({
        spacing: { after: 160, line: 276 },
        children: lines.flatMap((ln, i) => (i === 0 ? runs(ln) : [new TextRun({ break: 1, font: FONT }), ...runs(ln)])),
      }),
    );
  }
  const doc = new Document({ creator: args.name, title: `${args.name} cover letter`, sections: [page(c)] });
  return Packer.toBuffer(doc);
}
