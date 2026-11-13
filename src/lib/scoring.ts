// Server side of fit scoring v2: saves Claude's structured assessments as scores, tracks which
// profile revision each score was made against, and recomputes chances when a referral changes.
import { q, j } from './db';
import { getProfile, type Profile } from './profile';
import { sha256hex, clamp } from './util';
import { assess, outcome, profileYears, type Assessment, type ScoreDetail } from './fit';

/** Changes whenever something that affects scoring changes (not job titles, contact details or links). */
export function profileRev(p: Profile): string {
  const { basics, jobTitles: _t, target, ...rest } = p;
  // An unset target adds nothing, so scores made before targets existed stay current.
  const aim = target?.function || target?.alsoCalled?.length ? { target } : {};
  return sha256hex(JSON.stringify({ headline: basics.headline, summary: basics.summary, location: basics.location, ...rest, ...aim })).slice(0, 12);
}

export async function currentRev(uid: string): Promise<string> {
  return profileRev(await getProfile(uid));
}

const BASE_RATE = 0.04;

const daysSince = (v: unknown): number => {
  const t = v instanceof Date ? v.getTime() : v ? Date.parse(String(v)) : NaN;
  return Number.isFinite(t) ? Math.max(0, (Date.now() - t) / 86400e3) : 0;
};

export interface Scored {
  job_id: string;
  fit: number;
  win_pct: number;
  worth: number;
  effort: string;
  confidence: number;
  flags: string[];
}

export async function saveAssessments(uid: string, items: Assessment[]): Promise<{ saved: number; unknown: string[]; results: Scored[] }> {
  const profile = await getProfile(uid);
  const rev = profileRev(profile);
  const years = profileYears(profile);
  const profileText = JSON.stringify({ ...profile, preferences: undefined, target: undefined, jobTitles: undefined }).toLowerCase();
  const profileIds = new Set(
    [profile.experience, profile.projects, profile.education, profile.achievements, profile.publications].flatMap((list) => list.map((x) => x.id ?? '')).filter(Boolean),
  );
  const rows = await q(
    `SELECT id, company, posted_at, first_seen, length(description) AS desc_len, min_years, referral
       FROM jobs WHERE user_id = $1 AND id = ANY($2::text[])`,
    [uid, items.map((i) => i.job_id)],
  );
  const byId = new Map(rows.map((r) => [r.id as string, r]));
  const out: { job_id: string; score: number; reasons: string[]; flags: string[]; detail: ScoreDetail; worth: number }[] = [];
  const results: Scored[] = [];
  const unknown: string[] = [];
  for (const a of items) {
    const row = byId.get(a.job_id);
    if (!row) {
      unknown.push(a.job_id);
      continue;
    }
    const { detail, flags } = assess(a, {
      years,
      baseRate: profile.preferences.baseRate ?? BASE_RATE,
      blocked: profile.preferences.blockedCompanies,
      company: row.company ?? '',
      daysOld: daysSince(row.posted_at ?? row.first_seen),
      postedMinYears: row.min_years ?? null,
      descChars: Number(row.desc_len ?? 0),
      referral: Number(row.referral ?? 0),
      profileText,
      profileIds,
      experience: profile.experience,
    });
    const allFlags = [...flags, ...(a.flags ?? [])].slice(0, 6).map((x) => x.slice(0, 300));
    out.push({
      job_id: a.job_id,
      score: detail.fit,
      reasons: (a.reasons ?? []).slice(0, 6).map((x) => x.slice(0, 300)),
      flags: allFlags,
      detail,
      worth: detail.worth,
    });
    results.push({ job_id: a.job_id, fit: detail.fit, win_pct: detail.win_pct, worth: detail.worth, effort: detail.effort, confidence: detail.confidence, flags: allFlags });
  }
  let saved = 0;
  if (out.length) {
    const upd = await q(
      `UPDATE jobs SET score = x.score, score_reasons = x.reasons, score_flags = x.flags, score_detail = x.detail,
              worth = x.worth, scored_at = now(), score_profile = $3
       FROM jsonb_to_recordset($1::jsonb) AS x(job_id text, score int, reasons jsonb, flags jsonb, detail jsonb, worth real)
       WHERE jobs.id = x.job_id AND jobs.user_id = $2 RETURNING jobs.id`,
      [j(out), uid, rev],
    );
    saved = new Set(upd.map((r) => r.id)).size;
  }
  return { saved, unknown, results };
}

/** A person's own referral estimate (0 none, ~0.5 know someone, ~0.8 someone will refer). Recomputes the chances. */
export async function setReferral(uid: string, id: string, referral: number): Promise<boolean> {
  const r = clamp(referral, 0, 1);
  const rows = await q('UPDATE jobs SET referral = $3 WHERE id = $1 AND user_id = $2 RETURNING company, posted_at, first_seen, score_detail', [id, uid, r]);
  if (!rows.length) return false;
  const d = rows[0].score_detail as ScoreDetail | null;
  if (d?.v === 2) {
    const profile = await getProfile(uid);
    const stored = { ...d.stored, referral: r };
    const o = outcome(stored, {
      baseRate: profile.preferences.baseRate ?? BASE_RATE,
      blocked: profile.preferences.blockedCompanies,
      company: rows[0].company ?? '',
      daysOld: daysSince(rows[0].posted_at ?? rows[0].first_seen),
    });
    await q('UPDATE jobs SET score_detail = $3::jsonb, worth = $4 WHERE id = $1 AND user_id = $2', [id, uid, j({ ...d, ...o, stored }), o.worth]);
  }
  return true;
}
