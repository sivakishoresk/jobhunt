'use client';
import { useEffect, useState } from 'react';
import { api } from './bits';
import { CONNECT_FREE, CONNECT_MAX, MESSAGE_AIM, OUTREACH_KINDS, OUTREACH_LABEL, chars, hasOutreach, type Outreach, type OutreachKind } from '@/lib/outreach';

const HELP: Record<OutreachKind, string> = {
  connect_note: `Sent with the connection request. LinkedIn allows ${CONNECT_FREE} characters on a free account and ${CONNECT_MAX} on Premium.`,
  message: 'For a recruiter or the hiring manager: the role, two facts that match it, one ask.',
  referral_ask: 'For someone who works there. Say why you fit in a sentence and make it easy to say no.',
};
const ROWS: Record<OutreachKind, number> = { connect_note: 3, message: 6, referral_ask: 6 };
const limitOf = (k: OutreachKind) => (k === 'connect_note' ? CONNECT_FREE : MESSAGE_AIM);

const claudeLink = (prompt: string) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;

/** LinkedIn messages for one job: edit, see the length LinkedIn allows, copy. Nothing is sent from here. */
export function OutreachPanel({
  jobId, title, company, initial, onSaved, startOpen = false,
}: {
  jobId: string; title: string; company: string; initial: Outreach; onSaved?: (o: Outreach) => void; startOpen?: boolean;
}) {
  const [o, setO] = useState<Outreach>(initial);
  const [saved, setSaved] = useState<Outreach>(initial);
  const [open, setOpen] = useState(startOpen || hasOutreach(initial));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState<OutreachKind | null>(null);
  const dirty = OUTREACH_KINDS.some((k) => o[k] !== saved[k]);

  async function save() {
    if (!dirty || busy) return;
    setBusy(true);
    setNote('');
    try {
      const r = await api<{ outreach: Outreach }>(`/api/jobs/${jobId}`, {
        method: 'PATCH',
        json: { outreach: { connect_note: o.connect_note, message: o.message, referral_ask: o.referral_ask } },
      });
      setSaved(r.outreach);
      setO((cur) => ({ ...cur, checks: r.outreach.checks, updated_at: r.outreach.updated_at }));
      onSaved?.(r.outreach);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  async function copy(k: OutreachKind) {
    try {
      await navigator.clipboard.writeText(o[k].trim());
      setCopied(k);
      setTimeout(() => setCopied((c) => (c === k ? null : c)), 1500);
    } catch {
      setNote('Could not copy. Select the text and copy it by hand.');
    }
  }

  const draftHref = claudeLink(
    `Using my Jobhunt connector: read my profile and job ${jobId} (${title} at ${company}), then write LinkedIn messages for it and save them with save_outreach: a connection note, a message to the recruiter or hiring manager, and a referral ask. Straight to the point, one ask each, only facts from my profile.`,
  );
  const peopleHref = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(company)}`;

  return (
    <section className="outreach" aria-label="LinkedIn messages">
      <div className="outreach-head">
        <h3>LinkedIn messages</h3>
        {company && (
          <a className="hint" href={peopleHref} target="_blank" rel="noopener noreferrer">
            Find people at {company}
          </a>
        )}
      </div>
      {!open ? (
        <>
          <p className="hint">Short notes to a recruiter, the hiring manager or someone who could refer you. Not a cover letter: who you are, which role, one ask.</p>
          <div className="outreach-actions">
            <a className="btn small" href={draftHref} target="_blank" rel="noopener noreferrer">
              Draft with Claude
            </a>
            <button className="btn small quiet" onClick={() => setOpen(true)}>
              Write my own
            </button>
          </div>
        </>
      ) : (
        <>
          {OUTREACH_KINDS.map((k) => {
            const n = chars(o[k]);
            const limit = limitOf(k);
            const checks = o[k] === saved[k] ? o.checks.filter((c) => c.where.endsWith(OUTREACH_LABEL[k].toLowerCase())) : [];
            return (
              <div className="outreach-item" key={k}>
                <div className="outreach-label">
                  <label htmlFor={`or-${k}-${jobId}`}>{OUTREACH_LABEL[k]}</label>
                  <span className={`count${n > limit ? ' over' : ''}`} title={HELP[k]}>
                    {n} / {limit}
                  </span>
                  <button className="btn small quiet" disabled={!o[k].trim()} onClick={() => copy(k)}>
                    {copied === k ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <textarea id={`or-${k}-${jobId}`} rows={ROWS[k]} value={o[k]} placeholder={HELP[k]} onChange={(e) => setO((cur) => ({ ...cur, [k]: e.target.value }))} onBlur={save} />
                {k === 'connect_note' && n > CONNECT_FREE && n <= CONNECT_MAX && <p className="hint">Fits Premium ({CONNECT_MAX}) but not a free account ({CONNECT_FREE}).</p>}
                {checks.map((c, i) => (
                  <p className="outreach-check" key={i}>
                    <b>“{c.text}”</b> {c.issue}
                  </p>
                ))}
              </div>
            );
          })}
          <div className="outreach-actions">
            <a className="btn small" href={draftHref} target="_blank" rel="noopener noreferrer">
              {hasOutreach(o) ? 'Redraft with Claude' : 'Draft with Claude'}
            </a>
            <span className="hint" role="status">
              {note || (busy ? 'Saving…' : dirty ? 'Saves when you leave the box' : hasOutreach(o) ? 'Saved. You send these yourself on LinkedIn.' : '')}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

/** The same panel for places that only know the job id (the application editor). */
export function OutreachForJob({ jobId, title, company, onSaved }: { jobId: string; title: string; company: string; onSaved?: (o: Outreach) => void }) {
  const [initial, setInitial] = useState<Outreach | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<{ outreach: Outreach }>(`/api/jobs/${jobId}`)
      .then((j) => setInitial(j.outreach))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the job.'));
  }, [jobId]);
  if (error) return <p className="err">{error}</p>;
  if (!initial) return <p className="hint">Loading…</p>;
  return <OutreachPanel jobId={jobId} title={title} company={company} initial={initial} onSaved={onSaved} startOpen />;
}
