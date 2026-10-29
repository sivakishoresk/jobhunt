'use client';
import { Fragment, useEffect, useState, type ReactNode } from 'react';

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 86400 * 60) return `${Math.round(s / 86400)}d`;
  return `${Math.round(s / (86400 * 30))}mo`;
}

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[\s,/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Wraps matches of any term in <mark>. */
export function Highlight({ text, terms }: { text: string; terms: string[] }): ReactNode {
  if (!text || !terms.length) return text;
  const re = new RegExp(`(${terms.map(esc).join('|')})`, 'ig');
  const parts = text.split(re);
  return parts.map((p, i) => (i % 2 === 1 ? <mark key={i}>{p}</mark> : <Fragment key={i}>{p}</Fragment>));
}

export function Meter({ score }: { score: number | null }) {
  return (
    <span className={`meter${score != null && score >= 70 ? ' hi' : ''}`} title={score == null ? 'Not scored yet' : `Fit ${score}/100`} aria-hidden>
      {score != null && <i style={{ height: `${Math.max(6, score)}%` }} />}
    </span>
  );
}

export function useToast() {
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 6000 : 3500);
    return () => clearTimeout(t);
  }, [toast]);
  const node = toast ? (
    <div className="toast" role="status">
      <span>{toast.msg}</span>
      {toast.undo && (
        <button
          onClick={() => {
            toast.undo?.();
            setToast(null);
          }}
        >
          Undo
        </button>
      )}
    </div>
  ) : null;
  return { show: (msg: string, undo?: () => void) => setToast({ msg, undo }), node };
}

export async function api<T = any>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== 'undefined') window.location.href = '/login';
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export { renderBold } from '../lib/bold';
