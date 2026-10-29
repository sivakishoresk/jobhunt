'use client';
import Link from 'next/link';
import { useEffect } from 'react';

export function PrintBar({ auto, id, cover }: { auto: boolean; id: string; cover: boolean }) {
  useEffect(() => {
    if (auto) {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [auto]);
  return (
    <div className="noprint" style={{ display: 'flex', gap: 8, marginBottom: 12, justifyContent: 'center' }}>
      <button className="btn primary" onClick={() => window.print()}>
        Print or save as PDF
      </button>
      <Link className="btn" href={`/print/${id}?doc=${cover ? 'resume' : 'cover'}`}>
        Show the {cover ? 'resume' : 'cover letter'}
      </Link>
      <Link className="btn quiet" href={`/applications/${id}`}>
        Back to the application
      </Link>
    </div>
  );
}
