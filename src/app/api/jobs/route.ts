import { z } from 'zod';
import { withUser, bodyJson } from '@/lib/http';
import { listJobs, addManualJob } from '@/lib/jobs';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return withUser(req, async (me) => {
    const sp = new URL(req.url).searchParams;
    const res = await listJobs(me.uid, { state: 'all', sort: 'newest', limit: Number(sp.get('limit') ?? 1500) });
    return Response.json(res);
  });
}

const Manual = z.object({
  title: z.string().min(2),
  company: z.string().min(1),
  description: z.string().min(20),
  url: z.string().optional(),
  location: z.string().optional(),
  remote: z.boolean().optional(),
});

export async function POST(req: Request) {
  return withUser(req, async (me) => {
    const input = Manual.parse(await bodyJson(req));
    return Response.json(await addManualJob(me.uid, input));
  });
}
