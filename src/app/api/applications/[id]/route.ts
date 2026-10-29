import { z } from 'zod';
import { withUser, bodyJson } from '@/lib/http';
import { APP_STATUSES, deleteApplication, getApplication, updateApplication } from '@/lib/applications';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return withUser(req, async () => {
    const a = await getApplication((await params).id);
    return a ? Response.json(a) : Response.json({ error: 'Application not found.' }, { status: 404 });
  });
}

const Resume = z.object({
  name: z.string(),
  headline: z.string(),
  contact: z.array(z.string()),
  summary: z.string(),
  skills: z.array(z.string()),
  experience: z.array(z.object({ title: z.string(), company: z.string(), location: z.string(), start: z.string(), end: z.string(), bullets: z.array(z.string()) })),
  projects: z.array(z.object({ name: z.string(), link: z.string(), start: z.string(), end: z.string(), bullets: z.array(z.string()) })),
  education: z.array(z.object({ degree: z.string(), school: z.string(), start: z.string(), end: z.string(), detail: z.string() })),
  publications: z.array(z.string()),
});

const Patch = z.object({
  status: z.enum(APP_STATUSES).optional(),
  notes: z.string().max(10000).optional(),
  cover_letter: z.string().max(20000).optional(),
  resume: Resume.optional(),
  gaps: z.array(z.string()).optional(),
  checks: z.array(z.object({ where: z.string(), text: z.string(), issue: z.string() })).optional(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  return withUser(req, async () => {
    const a = await updateApplication((await params).id, Patch.parse(await bodyJson(req)));
    return a ? Response.json(a) : Response.json({ error: 'Application not found.' }, { status: 404 });
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  return withUser(req, async () => {
    const ok = await deleteApplication((await params).id);
    return ok ? Response.json({ ok: true }) : Response.json({ error: 'Application not found.' }, { status: 404 });
  });
}
