import { withUser, bodyJson } from '@/lib/http';
import { getSources, saveSources, PRESETS } from '@/lib/sources';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return withUser(req, async () =>
    Response.json({ sources: await getSources(), presets: PRESETS, apifyTokenSet: !!env('APIFY_TOKEN') }),
  );
}

export async function PUT(req: Request) {
  return withUser(req, async () => Response.json({ sources: await saveSources(await bodyJson(req)) }));
}
