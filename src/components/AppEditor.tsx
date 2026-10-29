'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { AppFull, AppStatus } from '@/lib/applications';
import type { ResumeDoc } from '@/lib/drafts';
import { api, useToast } from './bits';
import { LetterSheet, ResumeSheet, letterDate } from './sheets';

const STATUSES: AppStatus[] = ['draft', 'sent', 'interview', 'offer', 'rejected', 'withdrawn'];
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

export function AppEditor({ id }: { id: string }) {
  const [app, setApp] = useState<AppFull | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'resume' | 'cover'>('resume');
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

  return (
    <div className="editor">
      <aside className="editor-side noprint">
        <p style={{ margin: 0 }}>
          <Link href="/applications">← Applications</Link>
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
            PDF ({tab === 'cover' ? 'cover letter' : 'resume'})
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
          <LetterSheet name={doc.name} contact={doc.contact} date={letterDate(app.updated_at)} company={app.company} body={app.cover_letter} />
        ) : (
          <ResumeSheet doc={doc} />
        )}
      </main>
      {node}
    </div>
  );
}
