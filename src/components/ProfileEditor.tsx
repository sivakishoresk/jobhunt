'use client';
import { useEffect, useState } from 'react';
import type { Profile } from '@/lib/profile';
import { api, useToast } from './bits';

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

export function ProfileEditor() {
  const [p, setP] = useState<Profile | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const { show, node } = useToast();

  useEffect(() => {
    api<Profile>('/api/profile').then(setP).catch((e) => show(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => dirty && e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (!p) return <div className="page">Loading…</div>;
  const change = (fn: (x: Profile) => Profile) => {
    setP((x) => (x ? fn(x) : x));
    setDirty(true);
  };
  const basics = (k: keyof Profile['basics'], v: string) => change((x) => ({ ...x, basics: { ...x.basics, [k]: v } }));

  async function save() {
    if (!p) return;
    setSaving(true);
    try {
      setP(await api<Profile>('/api/profile', { method: 'PUT', json: p }));
      setDirty(false);
      show('Profile saved.');
    } catch (e) {
      show(e instanceof Error ? e.message : 'Could not save the profile.');
    } finally {
      setSaving(false);
    }
  }

  const empty = !p.basics.name && !p.experience.length;

  return (
    <div className="page">
      <h1>Profile</h1>
      <p className="hint" style={{ maxWidth: '60ch' }}>
        Every resume and cover letter Claude writes uses only what is on this page. Claude can read it without your email, phone or links.
      </p>
      {empty && (
        <p className="notice">
          Fastest way to fill this in: paste your current resume into a Claude chat with the Jobhunt connector on and say “Fill in my Jobhunt profile from this resume. Copy facts exactly.” Then check the result here.
        </p>
      )}

      <section>
        <h2>Basics</h2>
        <div className="grid2">
          <div><label className="field" htmlFor="b-name">Name</label><input id="b-name" type="text" value={p.basics.name} onChange={(e) => basics('name', e.target.value)} /></div>
          <div><label className="field" htmlFor="b-head">Headline</label><input id="b-head" type="text" value={p.basics.headline} onChange={(e) => basics('headline', e.target.value)} placeholder="AI engineer working on LLM reasoning" /></div>
          <div><label className="field" htmlFor="b-mail">Email</label><input id="b-mail" type="text" value={p.basics.email} onChange={(e) => basics('email', e.target.value)} /></div>
          <div><label className="field" htmlFor="b-ph">Phone</label><input id="b-ph" type="text" value={p.basics.phone} onChange={(e) => basics('phone', e.target.value)} /></div>
          <div><label className="field" htmlFor="b-loc">Location</label><input id="b-loc" type="text" value={p.basics.location} onChange={(e) => basics('location', e.target.value)} /></div>
          <div>
            <label className="field" htmlFor="b-links">Links, one per line</label>
            <textarea id="b-links" rows={2} defaultValue={p.basics.links.map((l) => l.url).join('\n')} onChange={(e) => change((x) => ({ ...x, basics: { ...x.basics, links: lines(e.target.value).map((url) => ({ label: '', url })) } }))} />
          </div>
        </div>
        <label className="field" htmlFor="b-sum">Summary</label>
        <textarea id="b-sum" rows={3} value={p.basics.summary} onChange={(e) => basics('summary', e.target.value)} />
      </section>

      <section>
        <h2>Skills</h2>
        <textarea aria-label="Skills" rows={3} defaultValue={p.skills.join(', ')} onChange={(e) => change((x) => ({ ...x, skills: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }))} />
        <p className="hint">Comma separated. Only skills listed here (or elsewhere in your profile) can go on a resume.</p>
      </section>

      <section>
        <h2>Experience</h2>
        {p.experience.map((e, i) => (
          <div className="entry" key={e.id ?? i}>
            <div className="entry-head">
              <b>{e.title || 'New role'}{e.company ? `, ${e.company}` : ''}</b>
              <button className="btn small quiet danger" onClick={() => change((x) => ({ ...x, experience: x.experience.filter((_, k) => k !== i) }))}>Remove</button>
            </div>
            <div className="grid2">
              <div><label className="field">Title</label><input type="text" value={e.title} onChange={(ev) => change((x) => ({ ...x, experience: x.experience.map((y, k) => (k === i ? { ...y, title: ev.target.value } : y)) }))} /></div>
              <div><label className="field">Company</label><input type="text" value={e.company} onChange={(ev) => change((x) => ({ ...x, experience: x.experience.map((y, k) => (k === i ? { ...y, company: ev.target.value } : y)) }))} /></div>
              <div><label className="field">Start</label><input type="text" value={e.start} placeholder="Jun 2024" onChange={(ev) => change((x) => ({ ...x, experience: x.experience.map((y, k) => (k === i ? { ...y, start: ev.target.value } : y)) }))} /></div>
              <div><label className="field">End</label><input type="text" value={e.end} placeholder="Present" onChange={(ev) => change((x) => ({ ...x, experience: x.experience.map((y, k) => (k === i ? { ...y, end: ev.target.value } : y)) }))} /></div>
            </div>
            <label className="field">Location</label>
            <input type="text" value={e.location} onChange={(ev) => change((x) => ({ ...x, experience: x.experience.map((y, k) => (k === i ? { ...y, location: ev.target.value } : y)) }))} />
            <label className="field">Bullets, one per line</label>
            <textarea rows={Math.max(4, e.bullets.length + 1)} defaultValue={e.bullets.join('\n')} onChange={(ev) => change((x) => ({ ...x, experience: x.experience.map((y, k) => (k === i ? { ...y, bullets: lines(ev.target.value) } : y)) }))} />
          </div>
        ))}
        <button className="btn small" onClick={() => change((x) => ({ ...x, experience: [...x.experience, { title: '', company: '', location: '', start: '', end: '', bullets: [] }] }))}>Add a role</button>
      </section>

      <section>
        <h2>Projects</h2>
        {p.projects.map((e, i) => (
          <div className="entry" key={e.id ?? i}>
            <div className="entry-head">
              <b>{e.name || 'New project'}</b>
              <button className="btn small quiet danger" onClick={() => change((x) => ({ ...x, projects: x.projects.filter((_, k) => k !== i) }))}>Remove</button>
            </div>
            <div className="grid2">
              <div><label className="field">Name</label><input type="text" value={e.name} onChange={(ev) => change((x) => ({ ...x, projects: x.projects.map((y, k) => (k === i ? { ...y, name: ev.target.value } : y)) }))} /></div>
              <div><label className="field">Link</label><input type="text" value={e.link} onChange={(ev) => change((x) => ({ ...x, projects: x.projects.map((y, k) => (k === i ? { ...y, link: ev.target.value } : y)) }))} /></div>
              <div><label className="field">Start</label><input type="text" value={e.start} onChange={(ev) => change((x) => ({ ...x, projects: x.projects.map((y, k) => (k === i ? { ...y, start: ev.target.value } : y)) }))} /></div>
              <div><label className="field">End</label><input type="text" value={e.end} onChange={(ev) => change((x) => ({ ...x, projects: x.projects.map((y, k) => (k === i ? { ...y, end: ev.target.value } : y)) }))} /></div>
            </div>
            <label className="field">Bullets, one per line</label>
            <textarea rows={Math.max(3, e.bullets.length + 1)} defaultValue={e.bullets.join('\n')} onChange={(ev) => change((x) => ({ ...x, projects: x.projects.map((y, k) => (k === i ? { ...y, bullets: lines(ev.target.value) } : y)) }))} />
          </div>
        ))}
        <button className="btn small" onClick={() => change((x) => ({ ...x, projects: [...x.projects, { name: '', link: '', start: '', end: '', bullets: [] }] }))}>Add a project</button>
      </section>

      <section>
        <h2>Education</h2>
        {p.education.map((e, i) => (
          <div className="entry" key={e.id ?? i}>
            <div className="entry-head">
              <b>{e.degree || 'New entry'}{e.school ? `, ${e.school}` : ''}</b>
              <button className="btn small quiet danger" onClick={() => change((x) => ({ ...x, education: x.education.filter((_, k) => k !== i) }))}>Remove</button>
            </div>
            <div className="grid2">
              <div><label className="field">Degree</label><input type="text" value={e.degree} onChange={(ev) => change((x) => ({ ...x, education: x.education.map((y, k) => (k === i ? { ...y, degree: ev.target.value } : y)) }))} /></div>
              <div><label className="field">School</label><input type="text" value={e.school} onChange={(ev) => change((x) => ({ ...x, education: x.education.map((y, k) => (k === i ? { ...y, school: ev.target.value } : y)) }))} /></div>
              <div><label className="field">Start</label><input type="text" value={e.start} onChange={(ev) => change((x) => ({ ...x, education: x.education.map((y, k) => (k === i ? { ...y, start: ev.target.value } : y)) }))} /></div>
              <div><label className="field">End</label><input type="text" value={e.end} onChange={(ev) => change((x) => ({ ...x, education: x.education.map((y, k) => (k === i ? { ...y, end: ev.target.value } : y)) }))} /></div>
            </div>
            <label className="field">Detail</label>
            <input type="text" value={e.detail} placeholder="Grade, honours" onChange={(ev) => change((x) => ({ ...x, education: x.education.map((y, k) => (k === i ? { ...y, detail: ev.target.value } : y)) }))} />
          </div>
        ))}
        <button className="btn small" onClick={() => change((x) => ({ ...x, education: [...x.education, { degree: '', school: '', start: '', end: '', detail: '' }] }))}>Add education</button>
      </section>

      <section>
        <h2>Publications</h2>
        <p className="hint">Each one goes onto a resume word for word.</p>
        {p.publications.map((e, i) => (
          <div className="entry" key={e.id ?? i}>
            <div className="entry-head">
              <b>{e.id}</b>
              <button className="btn small quiet danger" onClick={() => change((x) => ({ ...x, publications: x.publications.filter((_, k) => k !== i) }))}>Remove</button>
            </div>
            <textarea aria-label="Citation" rows={2} value={e.citation} onChange={(ev) => change((x) => ({ ...x, publications: x.publications.map((y, k) => (k === i ? { ...y, citation: ev.target.value } : y)) }))} />
          </div>
        ))}
        <button className="btn small" onClick={() => change((x) => ({ ...x, publications: [...x.publications, { citation: '' }] }))}>Add a publication</button>
      </section>

      <div className="savebar">
        <button className="btn primary" onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save profile'}</button>
        <span className="hint">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
      </div>
      {node}
    </div>
  );
}
