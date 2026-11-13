import { q, j, type Row } from './db';
import { newId } from './util';
import { iso, setJobState } from './jobs';
import type { Check, ResumeDoc } from './drafts';

/** Every application row, plus whether its job has LinkedIn messages drafted. */
const SELECT_APPS = `SELECT a.*, (COALESCE(jb.outreach->>'connect_note', '') <> '' OR COALESCE(jb.outreach->>'message', '') <> '' OR COALESCE(jb.outreach->>'referral_ask', '') <> '') AS has_linkedin
  FROM applications a LEFT JOIN jobs jb ON jb.id = a.job_id AND jb.user_id = a.user_id`;

/** An application can start with LinkedIn messages only, so its resume may still be empty. */
function resumeOf(v: unknown): ResumeDoc {
  const r = (v && typeof v === 'object' ? v : {}) as Partial<ResumeDoc>;
  const list = <T,>(x: T[] | undefined): T[] => (Array.isArray(x) ? x : []);
  return {
    name: r.name ?? '',
    headline: r.headline ?? '',
    contact: list(r.contact),
    summary: r.summary ?? '',
    skills: list(r.skills),
    experience: list(r.experience),
    projects: list(r.projects),
    education: list(r.education),
    achievements: list(r.achievements),
    publications: list(r.publications),
    ...(Array.isArray(r.layout) ? { layout: r.layout } : {}),
  };
}
const resumeDrafted = (r: ResumeDoc) => r.experience.length + r.projects.length + r.education.length > 0;

export const APP_STATUSES = ['draft', 'sent', 'interview', 'offer', 'rejected', 'withdrawn'] as const;
export type AppStatus = (typeof APP_STATUSES)[number];

export interface AppSummary {
  id: string;
  job_id: string | null;
  status: AppStatus;
  title: string;
  company: string;
  warnings: number;
  /** Which pieces have been drafted for this job. */
  has_resume: boolean;
  has_cover: boolean;
  has_linkedin: boolean;
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
    has_resume: resumeDrafted(resumeOf(r.resume)),
    has_cover: !!String(r.cover_letter ?? '').trim(),
    has_linkedin: !!r.has_linkedin,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
    sent_at: iso(r.sent_at),
  };
}

function full(r: Row): AppFull {
  return {
    ...summary(r),
    resume: resumeOf(r.resume),
    cover_letter: r.cover_letter ?? '',
    gaps: Array.isArray(r.gaps) ? r.gaps : [],
    checks: Array.isArray(r.checks) ? r.checks : [],
    notes: r.notes ?? '',
  };
}

export async function listApplications(uid: string, status?: string): Promise<AppSummary[]> {
  const rows = status
    ? await q(`${SELECT_APPS} WHERE a.user_id = $1 AND a.status = $2 ORDER BY a.updated_at DESC`, [uid, status])
    : await q(`${SELECT_APPS} WHERE a.user_id = $1 ORDER BY a.updated_at DESC`, [uid]);
  return rows.map(summary);
}

export async function getApplication(uid: string, id: string): Promise<AppFull | null> {
  const rows = await q(`${SELECT_APPS} WHERE a.id = $1 AND a.user_id = $2`, [id, uid]);
  return rows.length ? full(rows[0]) : null;
}

/**
 * The application that holds a job's drafts, created empty if there is none yet. LinkedIn messages can be
 * written before any resume, and they still need a place on the Applications page.
 */
export async function ensureApplication(uid: string, job: { id: string; title: string; company: string }): Promise<string> {
  const existing = await q(`SELECT id FROM applications WHERE job_id = $1 AND user_id = $2 ORDER BY (status = 'draft') DESC, updated_at DESC LIMIT 1`, [job.id, uid]);
  if (existing.length) {
    await q('UPDATE applications SET updated_at = now() WHERE id = $1', [existing[0].id]);
    return existing[0].id as string;
  }
  const id = newId('a');
  await q(`INSERT INTO applications (id, user_id, job_id, title, company) VALUES ($1, $2, $3, $4, $5)`, [id, uid, job.id, job.title, job.company]);
  await q(`UPDATE jobs SET state = 'saved' WHERE id = $1 AND user_id = $2 AND state = 'new'`, [job.id, uid]);
  return id;
}

export async function saveApplicationDraft(uid: string, args: {
  applicationId?: string;
  jobId: string;
  title: string;
  company: string;
  resume: ResumeDoc;
  coverLetter: string;
  gaps: string[];
  checks: Check[];
}): Promise<{ id: string; updated: boolean }> {
  if (!(await q('SELECT 1 FROM jobs WHERE id = $1 AND user_id = $2', [args.jobId, uid])).length) throw new Error('No job with that id.');
  let target = args.applicationId;
  if (!target) {
    const existing = await q(`SELECT id FROM applications WHERE job_id = $1 AND user_id = $2 AND status = 'draft' ORDER BY updated_at DESC LIMIT 1`, [args.jobId, uid]);
    if (existing.length) target = existing[0].id;
  }
  if (target) {
    const rows = await q(
      `UPDATE applications SET resume = $2::jsonb, cover_letter = $3, gaps = $4::jsonb, checks = $5::jsonb, updated_at = now()
       WHERE id = $1 AND user_id = $6 RETURNING id`,
      [target, j(args.resume), args.coverLetter, j(args.gaps), j(args.checks), uid],
    );
    if (rows.length) return { id: target, updated: true };
  }
  const id = newId('a');
  await q(
    `INSERT INTO applications (id, user_id, job_id, title, company, resume, cover_letter, gaps, checks)
     VALUES ($1,$9,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8::jsonb)`,
    [id, args.jobId, args.title, args.company, j(args.resume), args.coverLetter, j(args.gaps), j(args.checks), uid],
  );
  await q(`UPDATE jobs SET state = 'saved' WHERE id = $1 AND user_id = $2 AND state = 'new'`, [args.jobId, uid]);
  return { id, updated: false };
}

export async function updateApplication(
  uid: string,
  id: string,
  patch: { status?: AppStatus; notes?: string; cover_letter?: string; resume?: ResumeDoc; gaps?: string[]; checks?: Check[] },
): Promise<AppFull | null> {
  const cur = await getApplication(uid, id);
  if (!cur) return null;
  const status = patch.status ?? cur.status;
  const sentAt = status !== 'draft' && !cur.sent_at ? new Date().toISOString() : status === 'draft' ? null : cur.sent_at;
  await q(
    `UPDATE applications SET status = $2, notes = $3, cover_letter = $4, resume = $5::jsonb, gaps = $6::jsonb,
       checks = $7::jsonb, sent_at = $8, updated_at = now() WHERE id = $1 AND user_id = $9`,
    [
      id,
      status,
      patch.notes ?? cur.notes,
      patch.cover_letter ?? cur.cover_letter,
      j(patch.resume ?? cur.resume),
      j(patch.gaps ?? cur.gaps),
      j(patch.checks ?? cur.checks),
      sentAt,
      uid,
    ],
  );
  if (patch.status && cur.job_id) {
    if (status === 'draft') {
      // leaving "sent" states does not un-apply the job automatically
    } else {
      await setJobState(uid, [cur.job_id], 'applied');
    }
  }
  return getApplication(uid, id);
}

export async function deleteApplication(uid: string, id: string): Promise<boolean> {
  const rows = await q('DELETE FROM applications WHERE id = $1 AND user_id = $2 RETURNING id', [id, uid]);
  return rows.length > 0;
}
