import { z } from 'zod';
import { withUser, bodyJson } from '@/lib/http';
import { SourceSchema, renderInput } from '@/lib/sources';
import { startRun, getRun, getItems, TERMINAL_FAIL } from '@/lib/apify';
import { normalizeItem } from '@/lib/normalize';
import { sleep } from '@/lib/util';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const Body = z.object({
  source: SourceSchema,
  keywords: z.string().default('software engineer'),
  location: z.string().default(''),
});

async function report(sourceId: string, runId: string, wait: boolean) {
  const deadline = Date.now() + (wait ? 50_000 : 0);
  let info = await getRun(runId);
  while (info.status !== 'SUCCEEDED' && !TERMINAL_FAIL.has(info.status) && Date.now() < deadline) {
    await sleep(2500);
    info = await getRun(runId);
  }
  if (info.status === 'SUCCEEDED') {
    const items = await getItems(info.datasetId, 3);
    return {
      status: 'done',
      runId,
      count: items.length,
      raw: items[0] ?? null,
      normalized: items.map((it) => normalizeItem(sourceId, it)),
    };
  }
  if (TERMINAL_FAIL.has(info.status)) return { status: 'failed', runId, error: `Apify run ${info.status.toLowerCase()}${info.statusMessage ? `: ${info.statusMessage}` : ''}` };
  return { status: 'running', runId };
}

export async function POST(req: Request) {
  return withUser(req, async () => {
    const b = Body.parse(await bodyJson(req));
    const query = { keywords: b.keywords, location: b.location, remote: false, days: null as number | null };
    const input = renderInput(b.source.input, query, 3);
    const run = await startRun(b.source.actor, input);
    return Response.json({ input, ...(await report(b.source.id, run.id, true)) });
  });
}

export async function GET(req: Request) {
  return withUser(req, async () => {
    const sp = new URL(req.url).searchParams;
    return Response.json(await report(sp.get('source') ?? 'test', sp.get('run') ?? '', false));
  });
}
