import { withUser } from '@/lib/http';
import { getApplication } from '@/lib/applications';
import { letterDocx, resumeDocx } from '@/lib/docx';

export const dynamic = 'force-dynamic';

const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'document';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(req, async () => {
    const a = await getApplication((await params).id);
    if (!a) return Response.json({ error: 'Application not found.' }, { status: 404 });
    const doc = new URL(req.url).searchParams.get('doc') === 'cover' ? 'cover' : 'resume';
    const buf =
      doc === 'cover'
        ? await letterDocx({
            name: a.resume.name,
            contact: a.resume.contact,
            date: new Date(a.updated_at ?? Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }),
            company: a.company,
            body: a.cover_letter,
          })
        : await resumeDocx(a.resume);
    const file = `${slug(a.resume.name || 'resume')}-${slug(a.company)}-${doc === 'cover' ? 'cover-letter' : 'resume'}.docx`;
    return new Response(new Uint8Array(buf), {
      headers: { 'Content-Type': MIME, 'Content-Disposition': `attachment; filename="${file}"`, 'Cache-Control': 'no-store' },
    });
  });
}
