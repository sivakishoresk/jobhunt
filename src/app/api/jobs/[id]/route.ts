import { z } from 'zod';
import { withUser, bodyJson } from '@/lib/http';
import { getJob, setJobState, setJobNotes, setOutreach, JOB_STATES } from '@/lib/jobs';
import { getProfile } from '@/lib/profile';
import { OutreachInputSchema, mergeOutreach, hasOutreach } from '@/lib/outreach';
import { ensureApplication } from '@/lib/applications';
import { setReferral } from '@/lib/scoring';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return withUser(req, async (me) => {
    const job = await getJob(me.uid, (await params).id);
    return job ? Response.json(job) : Response.json({ error: 'Job not found.' }, { status: 404 });
  });
}

const Patch = z.object({ state: z.enum(JOB_STATES).optional(), notes: z.string().max(5000).optional(), referral: z.number().min(0).max(1).optional(), outreach: OutreachInputSchema.optional() });

export async function PATCH(req: Request, { params }: Ctx) {
  return withUser(req, async (me) => {
    const { id } = await params;
    const p = Patch.parse(await bodyJson(req));
    if (p.state) await setJobState(me.uid, [id], p.state);
    if (p.notes !== undefined) await setJobNotes(me.uid, id, p.notes);
    if (p.referral !== undefined) await setReferral(me.uid, id, p.referral);
    if (p.outreach) {
      const job = await getJob(me.uid, id);
      if (!job) return Response.json({ error: 'Job not found.' }, { status: 404 });
      // Re-checked on every save, so fixing a line clears its warning.
      const outreach = mergeOutreach(await getProfile(me.uid), job, job.outreach, p.outreach);
      await setOutreach(me.uid, id, outreach);
      // Drafted messages show up on the Applications page next to the resume and cover letter.
      const application_id = hasOutreach(outreach) ? await ensureApplication(me.uid, job) : null;
      return Response.json({ ok: true, outreach, application_id });
    }
    return Response.json({ ok: true });
  });
}
