'use client';
import type { JobFull } from '@/lib/jobs';
import { EFFORT_TEXT, type Effort } from '@/lib/fit';

const REFERRAL = [
  { v: 0, label: 'No contact' },
  { v: 0.5, label: 'I know someone there' },
  { v: 0.8, label: 'Someone will refer me' },
];

const dots = (e: number) => (e >= 0.9 ? '●●●●' : e >= 0.65 ? '●●●○' : e >= 0.45 ? '●●○○' : e >= 0.25 ? '●○○○' : '○○○○');

/** The numbers behind a score: what was matched, what was missing, and the estimated chance of a callback. */
export function ScoreBreakdown({ job, onReferral, rescoreHref }: { job: JobFull; onReferral: (v: number) => void; rescoreHref: string }) {
  const d = job.score_detail;
  if (!d) {
    return job.stale ? (
      <p className="hint stale-note">
        Scored in the older format, before your profile last changed.{' '}
        <a target="_blank" rel="noopener noreferrer" href={rescoreHref}>
          Ask Claude to re-score it
        </a>
      </p>
    ) : null;
  }
  const parts: [string, number][] = [
    ['Skills', d.parts.skills],
    ['Experience', d.parts.years],
    ['Domain', d.parts.domain],
    ['Role', d.parts.role],
  ];
  const ref = REFERRAL.reduce((best, r) => (Math.abs(r.v - job.referral) < Math.abs(best.v - job.referral) ? r : best), REFERRAL[0]);
  return (
    <div className="chances">
      {job.stale && (
        <p className="hint stale-note">
          Scored before your profile last changed.{' '}
          <a target="_blank" rel="noopener noreferrer" href={rescoreHref}>
            Ask Claude to re-score it
          </a>
        </p>
      )}
      <div className="stat-row">
        <div className="stat">
          <b>{d.win_pct}%</b>
          <span>Est. callback chance</span>
        </div>
        <div className="stat">
          <b>{d.worth}</b>
          <span>Worth (chance × appeal)</span>
        </div>
        <div className="stat">
          <b>
            {d.fit_low === d.fit_high ? d.fit : `${d.fit_low}–${d.fit_high}`}
          </b>
          <span>Fit range</span>
        </div>
      </div>
      <p className="effort">
        <b>{d.effort === 'skip' ? 'Skip' : `Effort ${d.effort}`}</b> · {EFFORT_TEXT[d.effort as Effort]}
      </p>
      <ul className="parts" aria-label="Score breakdown">
        {parts.map(([k, v]) => (
          <li key={k}>
            <span>{k}</span>
            <span className="bar" aria-hidden>
              <i style={{ width: `${Math.max(3, Math.round(v * 100))}%` }} />
            </span>
            <span className="pc">{Math.round(v * 100)}</span>
          </li>
        ))}
      </ul>
      {d.reqs.length > 0 && (
        <ul className="reqs" aria-label="Requirements and evidence">
          {d.reqs.map((r, i) => (
            <li key={i} className={r.evidence < 0.45 && r.tier !== 'preferred' ? 'miss' : ''}>
              <span className="dots" aria-label={`evidence ${Math.round(r.evidence * 100)} percent`}>{dots(r.evidence)}</span>
              <span>{r.skill}</span>
              <span className="tier">{r.tier}</span>
            </li>
          ))}
        </ul>
      )}
      {d.edge > 0 && <p className="hint">Standout strength counted: {d.edge_basis}</p>}
      <label className="field" htmlFor="referral">
        Referral
      </label>
      <select id="referral" value={ref.v} onChange={(e) => onReferral(Number(e.target.value))}>
        {REFERRAL.map((r) => (
          <option key={r.v} value={r.v}>
            {r.label}
          </option>
        ))}
      </select>
      <p className="hint">
        Counted {d.inputs.profile_years} years of {d.inputs.total_years != null ? `relevant experience (of your ${d.inputs.total_years})` : 'your experience'} against {d.inputs.min_years == null ? 'no stated ask' : `${d.inputs.min_years}+ years asked`}.
        Callback chance is a rough estimate for ranking jobs, not a forecast. Confidence {Math.round(d.confidence * 100)}%.
      </p>
    </div>
  );
}
