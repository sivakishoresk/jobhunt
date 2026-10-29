import { Fragment } from 'react';
import type { ResumeDoc } from '@/lib/drafts';
import { renderBold } from '../lib/bold';

const dates = (a: string, b: string) => [a, b].filter(Boolean).join(' – ');

export function ResumeSheet({ doc }: { doc: ResumeDoc }) {
  return (
    <div className="sheet" aria-label="Resume preview">
      <h1>{doc.name || 'Your name'}</h1>
      {doc.headline && <div className="headline">{renderBold(doc.headline)}</div>}
      {doc.contact.length > 0 && <div className="contact">{doc.contact.join('  |  ')}</div>}
      {doc.summary && (
        <>
          <h2>Summary</h2>
          <p>{renderBold(doc.summary)}</p>
        </>
      )}
      {doc.skills.length > 0 && (
        <>
          <h2>Skills</h2>
          <p>{doc.skills.join(', ')}</p>
        </>
      )}
      {doc.experience.length > 0 && (
        <>
          <h2>Experience</h2>
          {doc.experience.map((e, i) => (
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
          ))}
        </>
      )}
      {doc.projects.length > 0 && (
        <>
          <h2>Projects</h2>
          {doc.projects.map((p, i) => (
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
          ))}
        </>
      )}
      {doc.education.length > 0 && (
        <>
          <h2>Education</h2>
          {doc.education.map((e, i) => (
            <Fragment key={i}>
              <div className="line">
                <strong>
                  {e.degree}, {e.school}
                </strong>
                <span className="when">{dates(e.start, e.end)}</span>
              </div>
              {e.detail && <div className="sub">{e.detail}</div>}
            </Fragment>
          ))}
        </>
      )}
      {(doc.achievements?.length ?? 0) > 0 && (
        <>
          <h2>Scholastic Achievements</h2>
          <ul>
            {doc.achievements.map((a, i) => (
              <li key={i}>{renderBold(a)}</li>
            ))}
          </ul>
        </>
      )}
      {doc.publications.length > 0 && (
        <>
          <h2>Publications</h2>
          <ul>
            {doc.publications.map((p, i) => (
              <li key={i}>{renderBold(p)}</li>
            ))}
          </ul>
        </>
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
