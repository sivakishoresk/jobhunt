import { withUser, bodyJson } from '@/lib/http';
import { getSources, saveSources, PRESETS } from '@/lib/sources';
import { apifyStatus } from '@/lib/users';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return withUser(req, async (me) => {
    const apify = await apifyStatus(me.uid);
    return Response.json({ sources: await getSources(me.uid), presets: PRESETS, apifyTokenSet: apify.source !== 'none' });
  });
}

export async function PUT(req: Request) {
  return withUser(req, async (me) => Response.json({ sources: await saveSources(me.uid, await bodyJson(req)) }));
}
