import { Fragment, type ReactNode } from 'react';
import { layoutOf, type SectionKey } from '@/lib/layout';
import type { ResumeDoc } from '@/lib/drafts';
import { renderBold } from '../lib/bold';

const dates = (a: string, b: string) => [a, b].filter(Boolean).join(' – ');

export function ResumeSheet({ doc }: { doc: ResumeDoc }) {
  const body: Record<SectionKey, ReactNode> = {
    summary: doc.summary ? <p>{renderBold(doc.summary)}</p> : null,
    skills: doc.skills.length > 0 ? <p>{doc.skills.join(', ')}</p> : null,
    experience:
      doc.experience.length > 0
        ? doc.experience.map((e, i) => (
            <Fragment key={i}>
              <div className="line">
                <strong>
                  {e.title}, {e.company}
                </strong>
                <span className="when">{dates(e.start, e.end)}</span>
              </div>
              {e.location && <div className="sub">{e.location}</div>}
              <ul>
                {e.bullets.map((b, k) => (
                  <li key={k}>{renderBold(b)}</li>
                ))}
              </ul>
            </Fragment>
          ))
        : null,
    projects:
      doc.projects.length > 0
        ? doc.projects.map((p, i) => (
            <Fragment key={i}>
              <div className="line">
                <strong>{p.name}</strong>
                <span className="when">{dates(p.start, p.end)}</span>
              </div>
              {p.link && <div className="sub">{p.link}</div>}
              <ul>
                {p.bullets.map((b, k) => (
                  <li key={k}>{renderBold(b)}</li>
                ))}
              </ul>
            </Fragment>
          ))
        : null,
    education:
      doc.education.length > 0
        ? doc.education.map((e, i) => (
            <Fragment key={i}>
              <div className="line">
                <strong>
                  {e.degree}, {e.school}
                </strong>
                <span className="when">{dates(e.start, e.end)}</span>
              </div>
              {e.detail && <div className="sub">{e.detail}</div>}
            </Fragment>
          ))
        : null,
    achievements:
      (doc.achievements?.length ?? 0) > 0 ? (
        <ul>
          {doc.achievements.map((a, i) => (
            <li key={i}>{renderBold(a)}</li>
          ))}
        </ul>
      ) : null,
    publications:
      doc.publications.length > 0 ? (
        <ul>
          {doc.publications.map((p, i) => (
            <li key={i}>{renderBold(p)}</li>
          ))}
        </ul>
      ) : null,
  };
  return (
    <div className="sheet" aria-label="Resume preview">
      <h1>{doc.name || 'Your name'}</h1>
      {doc.headline && <div className="headline">{renderBold(doc.headline)}</div>}
      {doc.contact.length > 0 && <div className="contact">{doc.contact.join('  |  ')}</div>}
      {layoutOf(doc.layout).map((sec) =>
        body[sec.key] ? (
          <Fragment key={sec.key}>
            <h2>{sec.title}</h2>
            {body[sec.key]}
          </Fragment>
        ) : null,
      )}
    </div>
  );
}

export function LetterSheet({ name, contact, date, company, body }: { name: string; contact: string[]; date: string; company: string; body: string }) {
  const paras = body.replace(/\r\n/g, '\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className="sheet letter" aria-label="Cover letter preview">
      <p>
        <strong>{name}</strong>
        <br />
        <span className="contact">{contact.join('  |  ')}</span>
      </p>
      <p>{date}</p>
      <p>Hiring team, {company}</p>
      {paras.map((p, i) => (
        <p key={i}>
          {p.split('\n').map((ln, k) => (
            <Fragment key={k}>
              {k > 0 && <br />}
              {renderBold(ln)}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}

export function letterDate(iso: string | null): string {
  return new Date(iso ?? Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
}
