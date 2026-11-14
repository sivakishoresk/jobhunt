'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { AppFull, AppStatus } from '@/lib/applications';
import type { ResumeDoc } from '@/lib/drafts';
import { api, useToast } from './bits';
import { letterDate } from './sheets';
import { LetterSheet, ResumeSheet } from './Paged';
import { OutreachForJob } from './Outreach';
import { hasOutreach } from '@/lib/outreach';

type View = 'overview' | 'resume' | 'cover' | 'linkedin';
const claudeLink = (prompt: string) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;

/** One drafted piece of an application: says whether it exists and opens it. */
function PieceBox({
  title, drafted, detail, warn = 0, onOpen, openLabel, draftHref,
}: {
  title: string; drafted: boolean; detail?: string; warn?: number; onOpen?: () => void; openLabel?: string; draftHref?: string;
}) {
  return (
    <div className={`piece-box${drafted ? '' : ' empty'}`}>
      <button className="piece-open" onClick={onOpen} disabled={!onOpen}>
        <span className="piece-title">{title}</span>
        <span className={`piece-state${drafted ? ' done' : ''}`}>{drafted ? 'Drafted' : 'Not drafted yet'}</span>
        {detail && <span className="piece-detail">{detail}</span>}
        {warn > 0 && <span className="warn">{warn} to check</span>}
        {onOpen && <span className="piece-go">{openLabel ?? 'Open'} →</span>}
      </button>
      {draftHref && (
        <a className={drafted ? 'piece-redraft' : 'btn small'} href={draftHref} target="_blank" rel="noopener noreferrer">
          {drafted ? 'Redraft with Claude' : 'Draft with Claude'}
        </a>
      )}
    </div>
  );
}

const STATUSES: AppStatus[] = ['draft', 'sent', 'interview', 'offer', 'rejected', 'withdrawn'];
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

export function AppEditor({ id }: { id: string }) {
  const [app, setApp] = useState<AppFull | null>(null);
  const [error, setError] = useState('');
  // Opens on the three drafts as boxes; ?doc=resume|cover|linkedin goes straight to one.
  const [view, setView] = useState<View>('overview');
  const tab: 'resume' | 'cover' = view === 'cover' ? 'cover' : 'resume';
  const open = (v: View) => {
    setView(v);
    window.history.replaceState(null, '', v === 'overview' ? window.location.pathname : `?doc=${v}`);
    window.scrollTo(0, 0);
  };
  const setTab = open;
  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get('doc');
    if (d === 'resume' || d === 'cover' || d === 'linkedin') setView(d);
  }, []);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const { show, node } = useToast();

  useEffect(() => {
    api<AppFull>(`/api/applications/${id}`).then(setApp).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (error) return <div className="page"><p className="err">{error}</p><Link href="/applications">Back to applications</Link></div>;
  if (!app) return <div className="page">Loading…</div>;

  const edit = (fn: (a: AppFull) => AppFull) => {
    setApp((a) => (a ? fn(a) : a));
    setDirty(true);
  };
  const doc = app.resume;
  const setDoc = (patch: Partial<ResumeDoc>) => edit((a) => ({ ...a, resume: { ...a.resume, ...patch } }));

  async function save() {
    if (!app) return;
    setSaving(true);
    try {
      const saved = await api<AppFull>(`/api/applications/${id}`, {
        method: 'PATCH',
        json: { resume: app.resume, cover_letter: app.cover_letter, notes: app.notes, gaps: app.gaps, checks: app.checks },
      });
      setApp(saved);
      setDirty(false);
      show('Saved.');
    } catch (e) {
      show(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(status: AppStatus) {
    try {
      const saved = await api<AppFull>(`/api/applications/${id}`, { method: 'PATCH', json: { status } });
      setApp((a) => (a ? { ...a, status: saved.status, sent_at: saved.sent_at } : a));
      show(`Status: ${status}.`);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Could not change status.');
    }
  }

  if (view === 'overview' || view === 'linkedin') {
    const job = app.job_id ? `job ${app.job_id} (${app.title} at ${app.company})` : `the ${app.title} role at ${app.company}`;
    const draftDocs = claudeLink(
      `Using my Jobhunt connector: read my profile and ${job}, write a tailored resume and cover letter using only facts from my profile, check the draft, and save it as an application. List any gaps.`,
    );
    const draftLinkedin = claudeLink(
      `Using my Jobhunt connector: read my profile and ${job}, then write LinkedIn messages for it and save them with save_outreach: a connection note, a message to the recruiter or hiring manager, and a referral ask. Straight to the point, one ask each, only facts from my profile.`,
    );
    const coverWarn = app.checks.filter((c) => c.where === 'Cover letter').length;
    const cover = app.cover_letter.trim();
    return (
      <div className="page app-page">
        <p style={{ margin: 0 }}>
          {view === 'linkedin' ? (
            <button className="btn quiet small" onClick={() => open('overview')}>
              ← All drafts for this job
            </button>
          ) : (
            <Link href="/applications">← Applications</Link>
          )}
        </p>
        <h1 style={{ marginTop: '0.5rem' }}>{app.title}</h1>
        <p className="hint">{app.company}</p>
        {view === 'linkedin' ? (
          app.job_id ? (
            <OutreachForJob jobId={app.job_id} title={app.title} company={app.company} onSaved={(o) => setApp((a) => (a ? { ...a, has_linkedin: hasOutreach(o) } : a))} />
          ) : (
            <p className="hint">The job this application was written for is no longer in your list, so there is nowhere to keep LinkedIn messages for it.</p>
          )
        ) : (
          <>
            <div className="piece-grid">
              <PieceBox
                title="Resume"
                drafted={app.has_resume}
                detail={app.has_resume ? [doc.headline, `${doc.experience.length} role${doc.experience.length === 1 ? '' : 's'}`, doc.projects.length ? `${doc.projects.length} project${doc.projects.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') : 'Tailored to this posting from your profile.'}
                warn={app.checks.length - coverWarn}
                onOpen={app.has_resume ? () => open('resume') : undefined}
                draftHref={app.job_id ? draftDocs : undefined}
              />
              <PieceBox
                title="Cover letter"
                drafted={app.has_cover}
                detail={cover ? `${cover.slice(0, 150)}${cover.length > 150 ? '…' : ''}` : 'A few paragraphs making the case.'}
                warn={coverWarn}
                onOpen={() => open('cover')}
                openLabel={app.has_cover ? 'Open' : 'Write it yourself'}
                draftHref={app.job_id ? draftDocs : undefined}
              />
              <PieceBox
                title="LinkedIn message"
                drafted={app.has_linkedin}
                detail={app.has_linkedin ? 'Connection note, message and referral ask, with character counts and copy buttons.' : 'Short notes to a recruiter or someone who could refer you.'}
                onOpen={app.job_id ? () => open('linkedin') : undefined}
                openLabel={app.has_linkedin ? 'Open' : 'Write it yourself'}
                draftHref={app.job_id ? draftLinkedin : undefined}
              />
            </div>
            {dirty && <p className="hint">You have unsaved changes in the resume or cover letter. Open one to save them.</p>}

            <label className="field" htmlFor="status-o">Status</label>
            <select id="status-o" style={{ maxWidth: '16rem' }} value={app.status} onChange={(e) => setStatus(e.target.value as AppStatus)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
            <p className="hint">Changing status only records it. Nothing is sent from here.</p>
            {app.gaps.length > 0 && (
              <>
                <h2 style={{ fontSize: '1rem', marginTop: '1.2rem' }}>Gaps Claude found</h2>
                <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                  {app.gaps.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
        {node}
      </div>
    );
  }

  return (
    <div className="editor">
      <aside className="editor-side noprint">
        <p style={{ margin: 0 }}>
          <button className="btn quiet small" onClick={() => open('overview')}>
            ← All drafts for this job
          </button>
        </p>
        <h1 style={{ fontSize: '1.25rem', margin: '0.4rem 0 0' }}>{app.title}</h1>
        <p className="hint" style={{ margin: 0 }}>
          {app.company}
          {app.job_id && (
            <>
              {' '}
              · <Link href="/">job list</Link>
            </>
          )}
        </p>

        <label className="field" htmlFor="status">Status</label>
        <select id="status" value={app.status} onChange={(e) => setStatus(e.target.value as AppStatus)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
        <p className="hint">Changing status only records it. Nothing is sent from here.</p>

        {(app.checks.length > 0 || app.gaps.length > 0) && <h2 style={{ fontSize: '1rem', marginTop: '1rem' }}>Before you send</h2>}
        {app.checks.map((c, i) => (
          <div className="check-item" key={i}>
            <b>
              {c.where}: “{c.text}”
            </b>
            <span>{c.issue}</span>
            <button className="btn small quiet" onClick={() => edit((a) => ({ ...a, checks: a.checks.filter((_, k) => k !== i) }))}>
              It's correct, dismiss
            </button>
          </div>
        ))}
        {app.gaps.length > 0 && (
          <>
            <h3 style={{ fontSize: '0.95rem', marginTop: '0.8rem' }}>Gaps Claude found</h3>
            <p className="hint">Requirements in the posting that your profile doesn't cover.</p>
            <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
              {app.gaps.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          </>
        )}

        <div className="tabs" role="tablist" style={{ marginTop: '1rem' }}>
          <button role="tab" aria-selected={tab === 'resume'} onClick={() => setTab('resume')}>Resume</button>
          <button role="tab" aria-selected={tab === 'cover'} onClick={() => setTab('cover')}>Cover letter</button>
          <button role="tab" aria-selected={false} onClick={() => setTab('linkedin')}>LinkedIn</button>
        </div>

        {tab === 'cover' ? (
          <>
            <label className="field" htmlFor="cl">Cover letter</label>
            <textarea id="cl" rows={18} value={app.cover_letter} onChange={(e) => edit((a) => ({ ...a, cover_letter: e.target.value }))} />
            <p className="hint">Blank line between paragraphs. Wrap words in **double asterisks** for bold.</p>
          </>
        ) : (
          <>
            <label className="field" htmlFor="hl">Headline</label>
            <input id="hl" type="text" value={doc.headline} onChange={(e) => setDoc({ headline: e.target.value })} />
            <label className="field" htmlFor="sm">Summary</label>
            <textarea id="sm" rows={4} value={doc.summary} onChange={(e) => setDoc({ summary: e.target.value })} />
            <label className="field" htmlFor="sk">Skills (comma separated)</label>
            <textarea id="sk" rows={3} value={doc.skills.join(', ')} onChange={(e) => setDoc({ skills: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
            {doc.experience.map((x, i) => (
              <div className="entry" key={`e${i}`}>
                <b>{x.title}, {x.company}</b>
                <label className="field" htmlFor={`eb${i}`}>Bullets, one per line</label>
                <textarea
                  id={`eb${i}`}
                  rows={Math.max(4, x.bullets.length + 1)}
                  defaultValue={x.bullets.join('\n')}
                  onChange={(e) => setDoc({ experience: doc.experience.map((y, k) => (k === i ? { ...y, bullets: lines(e.target.value) } : y)) })}
                />
              </div>
            ))}
            {doc.projects.map((x, i) => (
              <div className="entry" key={`p${i}`}>
                <b>{x.name}</b>
                <label className="field" htmlFor={`pb${i}`}>Bullets, one per line</label>
                <textarea
                  id={`pb${i}`}
                  rows={Math.max(3, x.bullets.length + 1)}
                  defaultValue={x.bullets.join('\n')}
                  onChange={(e) => setDoc({ projects: doc.projects.map((y, k) => (k === i ? { ...y, bullets: lines(e.target.value) } : y)) })}
                />
              </div>
            ))}
            <p className="hint">Use **double asterisks** around keywords and metrics to bold them.</p>
          </>
        )}

        <label className="field" htmlFor="nt">Your notes</label>
        <textarea id="nt" rows={3} value={app.notes} onChange={(e) => edit((a) => ({ ...a, notes: e.target.value }))} />

        <h2 style={{ fontSize: '1rem', marginTop: '1.1rem' }}>Export</h2>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <a className="btn small" target="_blank" rel="noopener noreferrer" href={`/print/${id}?doc=${tab}&auto=1`}>
            Print view ({tab === 'cover' ? 'cover letter' : 'resume'})
          </a>
          <a className="btn small" href={`/api/applications/${id}/docx?doc=resume`}>Resume .docx</a>
          <a className="btn small" href={`/api/applications/${id}/docx?doc=cover`}>Cover letter .docx</a>
        </div>
        <p style={{ marginTop: '1.2rem' }}>
          <button
            className="btn small danger"
            onClick={async () => {
              if (!confirm('Delete this application? This cannot be undone.')) return;
              await api(`/api/applications/${id}`, { method: 'DELETE' });
              window.location.href = '/applications';
            }}
          >
            Delete application
          </button>
        </p>
        <div className="savebar">
          <button className="btn primary" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <span className="hint">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
        </div>
      </aside>
      <main className="editor-main">
        {tab === 'cover' ? (
          <LetterSheet name={doc.name} contact={doc.contact} date={letterDate(app.updated_at)} company={app.company} body={app.cover_letter} pdf={dirty ? undefined : { id, doc: 'cover' }} />
        ) : (
          <ResumeSheet doc={doc} storeKey={id} pdf={dirty ? undefined : { id, doc: 'resume' }} />
        )}
      </main>
      {node}
    </div>
  );
}
