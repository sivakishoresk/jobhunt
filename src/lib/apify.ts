import { apifyBase, env } from './env';

export class ApifyError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function actorPath(actor: string): string {
  // "user/name" -> "user~name"; ids pass through
  return actor.trim().replace('/', '~');
}

async function call(token: string, path: string, init: RequestInit = {}): Promise<any> {
  if (!token) throw new ApifyError('No Apify token. Add yours in Settings.', 500);
  const res = await fetch(`${apifyBase()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    cache: 'no-store',
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const apiMsg: string = body?.error?.message ?? text.slice(0, 300) ?? res.statusText;
    const type: string = body?.error?.type ?? '';
    let hint = '';
    if (res.status === 401) hint = ' Check your Apify token in Settings.';
    else if (res.status === 402 || /credit|limit|usage|payment|rent/i.test(apiMsg + type))
      hint = ' This usually means the Apify account is out of credit, or the actor needs a paid rental first.';
    else if (res.status === 404) hint = ' The actor was not found. Check the actor name in Settings → Sources.';
    else if (res.status === 400) hint = ' Apify rejected the actor input. Check the input template in Settings → Sources.';
    throw new ApifyError(`Apify ${res.status}: ${apiMsg}${hint}`, res.status);
  }
  return body;
}

export interface RunInfo {
  id: string;
  status: string;
  datasetId: string;
}

export async function startRun(token: string, actor: string, input: unknown): Promise<RunInfo> {
  const params = new URLSearchParams();
  const cap = env('APIFY_MAX_CHARGE_USD') || '1';
  if (Number(cap) > 0) params.set('maxTotalChargeUsd', cap);
  params.set('timeout', '600');
  const body = await call(token, `/v2/acts/${actorPath(actor)}/runs?${params}`, {
    method: 'POST',
    body: JSON.stringify(input ?? {}),
  });
  const d = body?.data;
  if (!d?.id) throw new ApifyError('Apify did not return a run id.', 502);
  return { id: d.id, status: d.status, datasetId: d.defaultDatasetId };
}

export async function getRun(token: string, runId: string): Promise<RunInfo & { statusMessage?: string }> {
  const body = await call(token, `/v2/actor-runs/${encodeURIComponent(runId)}`);
  const d = body?.data;
  return { id: d.id, status: d.status, datasetId: d.defaultDatasetId, statusMessage: d.statusMessage };
}

export async function getItems(token: string, datasetId: string, limit = 500): Promise<Record<string, unknown>[]> {
  const body = await call(
    token,
    `/v2/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&limit=${limit}`,
  );
  return Array.isArray(body) ? body : [];
}

export async function abortRun(token: string, runId: string): Promise<void> {
  try {
    await call(token, `/v2/actor-runs/${encodeURIComponent(runId)}/abort`, { method: 'POST' });
  } catch {
    /* best effort */
  }
}

export const TERMINAL_FAIL = new Set(['FAILED', 'ABORTED', 'ABORTING', 'TIMED-OUT', 'TIMING-OUT']);
