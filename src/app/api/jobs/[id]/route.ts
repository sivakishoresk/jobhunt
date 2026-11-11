import { z } from 'zod';
import { withUser, bodyJson } from '@/lib/http';
import { getJob, setJobState, setJobNotes, JOB_STATES } from '@/lib/jobs';
import { setReferral } from '@/lib/scoring';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return withUser(req, async (me) => {
    const job = await getJob(me.uid, (await params).id);
    return job ? Response.json(job) : Response.json({ error: 'Job not found.' }, { status: 404 });
  });
}

const Patch = z.object({ state: z.enum(JOB_STATES).optional(), notes: z.string().max(5000).optional(), referral: z.number().min(0).max(1).optional() });

export async function PATCH(req: Request, { params }: Ctx) {
  return withUser(req, async (me) => {
    const { id } = await params;
    const p = Patch.parse(await bodyJson(req));
    if (p.state) await setJobState(me.uid, [id], p.state);
    if (p.notes !== undefined) await setJobNotes(me.uid, id, p.notes);
    if (p.referral !== undefined) await setReferral(me.uid, id, p.referral);
    return Response.json({ ok: true });
  });
}
