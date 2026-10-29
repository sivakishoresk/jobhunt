import { q, j, type Row } from './db';
import { newId } from './util';
import { iso, setJobState } from './jobs';
import type { Check, ResumeDoc } from './drafts';

export const APP_STATUSES = ['draft', 'sent', 'interview', 'offer', 'rejected', 'withdrawn'] as const;
export type AppStatus = (typeof APP_STATUSES)[number];

export interface AppSummary {
  id: string;
  job_id: string | null;
  status: AppStatus;
  title: string;
  company: string;
  warnings: number;
  created_at: string | null;
  updated_at: string | null;
  sent_at: string | null;
}

export interface AppFull extends AppSummary {
  resume: ResumeDoc;
  cover_letter: string;
  gaps: string[];
  checks: Check[];
  notes: string;
}

function summary(r: Row): AppSummary {
  return {
    id: r.id,
    job_id: r.job_id ?? null,
    status: r.status,
    title: r.title,
    company: r.company,
    warnings: Array.isArray(r.checks) ? r.checks.length : 0,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
    sent_at: iso(r.sent_at),
  };
}

function full(r: Row): AppFull {
  return {
    ...summary(r),
    resume: r.resume as ResumeDoc,
    cover_letter: r.cover_letter ?? '',
    gaps: Array.isArray(r.gaps) ? r.gaps : [],
    checks: Array.isArray(r.checks) ? r.checks : [],
    notes: r.notes ?? '',
  };
}

export async function listApplications(status?: string): Promise<AppSummary[]> {
  const rows = status
    ? await q('SELECT * FROM applications WHERE status = $1 ORDER BY updated_at DESC', [status])
    : await q('SELECT * FROM applications ORDER BY updated_at DESC');
  return rows.map(summary);
}

export async function getApplication(id: string): Promise<AppFull | null> {
  const rows = await q('SELECT * FROM applications WHERE id = $1', [id]);
  return rows.length ? full(rows[0]) : null;
}

export async function saveApplicationDraft(args: {
  applicationId?: string;
  jobId: string;
  title: string;
  company: string;
  resume: ResumeDoc;
  coverLetter: string;
  gaps: string[];
  checks: Check[];
}): Promise<{ id: string; updated: boolean }> {
  let target = args.applicationId;
  if (!target) {
    const existing = await q(`SELECT id FROM applications WHERE job_id = $1 AND status = 'draft' ORDER BY updated_at DESC LIMIT 1`, [args.jobId]);
    if (existing.length) target = existing[0].id;
  }
  if (target) {
    const rows = await q(
      `UPDATE applications SET resume = $2::jsonb, cover_letter = $3, gaps = $4::jsonb, checks = $5::jsonb, updated_at = now()
       WHERE id = $1 RETURNING id`,
      [target, j(args.resume), args.coverLetter, j(args.gaps), j(args.checks)],
    );
    if (rows.length) return { id: target, updated: true };
  }
  const id = newId('a');
  await q(
    `INSERT INTO applications (id, job_id, title, company, resume, cover_letter, gaps, checks)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8::jsonb)`,
    [id, args.jobId, args.title, args.company, j(args.resume), args.coverLetter, j(args.gaps), j(args.checks)],
  );
  await q(`UPDATE jobs SET state = 'saved' WHERE id = $1 AND state = 'new'`, [args.jobId]);
  return { id, updated: false };
}

export async function updateApplication(
  id: string,
  patch: { status?: AppStatus; notes?: string; cover_letter?: string; resume?: ResumeDoc; gaps?: string[]; checks?: Check[] },
): Promise<AppFull | null> {
  const cur = await getApplication(id);
  if (!cur) return null;
  const status = patch.status ?? cur.status;
  const sentAt = status !== 'draft' && !cur.sent_at ? new Date().toISOString() : status === 'draft' ? null : cur.sent_at;
  await q(
    `UPDATE applications SET status = $2, notes = $3, cover_letter = $4, resume = $5::jsonb, gaps = $6::jsonb,
       checks = $7::jsonb, sent_at = $8, updated_at = now() WHERE id = $1`,
    [
      id,
      status,
      patch.notes ?? cur.notes,
      patch.cover_letter ?? cur.cover_letter,
      j(patch.resume ?? cur.resume),
      j(patch.gaps ?? cur.gaps),
      j(patch.checks ?? cur.checks),
      sentAt,
    ],
  );
  if (patch.status && cur.job_id) {
    if (status === 'draft') {
      // leaving "sent" states does not un-apply the job automatically
    } else {
      await setJobState([cur.job_id], 'applied');
    }
  }
  return getApplication(id);
}

export async function deleteApplication(id: string): Promise<boolean> {
  const rows = await q('DELETE FROM applications WHERE id = $1 RETURNING id', [id]);
  return rows.length > 0;
}
