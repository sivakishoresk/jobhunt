'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { AppStatus, AppSummary } from '@/lib/applications';
import { api, timeAgo, useToast } from './bits';

const COLS: { id: AppStatus; label: string }[] = [
  { id: 'draft', label: 'Draft' },
  { id: 'sent', label: 'Sent' },
  { id: 'interview', label: 'Interview' },
  { id: 'offer', label: 'Offer' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'withdrawn', label: 'Withdrawn' },
];

export function Board() {
  const [apps, setApps] = useState<AppSummary[] | null>(null);
  const [over, setOver] = useState<AppStatus | null>(null);
  const { show, node } = useToast();

  useEffect(() => {
    api<{ applications: AppSummary[] }>('/api/applications').then((r) => setApps(r.applications)).catch((e) => show(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function move(id: string, status: AppStatus) {
    const prev = apps;
    setApps((a) => a?.map((x) => (x.id === id ? { ...x, status } : x)) ?? null);
    try {
      await api(`/api/applications/${id}`, { method: 'PATCH', json: { status } });
    } catch (e) {
      setApps(prev);
      show(e instanceof Error ? e.message : 'Could not move the application.');
    }
  }

  if (!apps) return <div className="page">Loading…</div>;
  if (apps.length === 0) {
    return (
      <div className="page">
        <h1>Applications</h1>
        <div className="empty" style={{ padding: '1rem 0' }}>
          <h3>Nothing here yet</h3>
          <p>Open a job and choose <b>Draft with Claude</b>, or ask Claude to write an application for one of your saved jobs. Drafts show up here for you to review.</p>
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="board" aria-label="Applications by status">
        {COLS.map((c) => {
          const items = apps.filter((a) => a.status === c.id);
          return (
            <section
              key={c.id}
              className={`col${over === c.id ? ' over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(c.id);
              }}
              onDragLeave={() => setOver((o) => (o === c.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData('text/plain');
                if (id) move(id, c.id);
              }}
            >
              <h3>
                {c.label} <span className="hint">{items.length}</span>
              </h3>
              {items.map((a) => (
                <Link key={a.id} href={`/applications/${a.id}`} className="item" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', a.id)}>
                  <b>{a.company}</b>
                  <small>{a.title}</small>
                  <small> · {timeAgo(a.updated_at)} ago</small>
                  {a.warnings > 0 && (
                    <div className="warn">
                      {a.warnings} to check
                    </div>
                  )}
                </Link>
              ))}
            </section>
          );
        })}
      </div>
      <p className="hint" style={{ padding: '0 1rem' }}>Drag an application to another column to change its status.</p>
      {node}
    </>
  );
}
