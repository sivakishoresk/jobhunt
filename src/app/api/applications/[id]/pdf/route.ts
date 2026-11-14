import { z } from 'zod';
import { withUser, bodyJson } from '@/lib/http';
import { getApplication } from '@/lib/applications';
import { SESSION_COOKIE } from '@/lib/auth';
import { baseUrl } from '@/lib/env';
import { renderPdf } from '@/lib/pdf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'document';

const Options = z.object({
  doc: z.enum(['resume', 'cover']).default('resume'),
  paper: z.enum(['a4', 'letter']).default('a4'),
  /** auto: one page when it fits, otherwise two. */
  pages: z.enum(['auto', '1', '2']).default('auto'),
  /** Bullets to leave out of this file only (their text). The saved resume is not changed. */
  hidden: z.array(z.string().max(2000)).max(200).default([]),
});

async function make(req: Request, { params }: Ctx, input: unknown) {
  return withUser(req, async (me) => {
    const o = Options.parse(input);
    const id = (await params).id;
    const a = await getApplication(me.uid, id);
    if (!a) return Response.json({ error: 'Application not found.' }, { status: 404 });
    const token = (req.headers.get('cookie') ?? '').split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
    if (!token) return Response.json({ error: 'Server-side PDF needs a browser session. Open the app, sign in and download it there.' }, { status: 400 });

    const storage: Record<string, string> = { 'jh.paper': o.paper };
    if (o.pages !== 'auto') storage['jh.pages'] = o.pages;
    if (o.hidden.length) storage[`jh.trim.${id}`] = JSON.stringify(o.hidden);
    const r = await renderPdf({ origin: baseUrl(req), path: `/print/${encodeURIComponent(id)}?doc=${o.doc}`, cookie: { name: SESSION_COOKIE, value: token }, storage });

    const file = `${slug(a.resume.name || 'resume')}-${slug(a.company)}-${o.doc === 'cover' ? 'cover-letter' : 'resume'}.pdf`;
    return new Response(Buffer.from(r.pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${file}"`,
        'Cache-Control': 'no-store',
        // The page check, so a caller can tell a clean one- or two-page file from one that is flagged.
        'X-Jobhunt-Fit': r.fit,
        'X-Jobhunt-Pages': String(r.pages),
        'X-Jobhunt-Fit-Message': encodeURIComponent(r.message),
      },
    });
  });
}

/** /api/applications/:id/pdf?doc=resume|cover&paper=a4|letter&pages=auto|1|2 */
export async function GET(req: Request, ctx: Ctx) {
  const q = new URL(req.url).searchParams;
  return make(req, ctx, { doc: q.get('doc') ?? undefined, paper: q.get('paper') ?? undefined, pages: q.get('pages') ?? undefined });
}

/** Same, with the options as JSON, plus `hidden` for bullets left out of this file. */
export async function POST(req: Request, ctx: Ctx) {
  return make(req, ctx, await bodyJson(req));
}
