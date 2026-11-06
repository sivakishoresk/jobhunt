import { z } from 'zod';
import { withOwner, bodyJson } from '@/lib/http';
import { MAX_PASSWORD, MIN_PASSWORD, deleteUser, setPassword } from '@/lib/users';
import { q } from '@/lib/db';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ password: z.string().min(MIN_PASSWORD, `Password must be at least ${MIN_PASSWORD} characters.`).max(MAX_PASSWORD) });

/** Owner sets a new password for someone who forgot theirs. Their old sessions and Claude connections stop working. */
export async function PATCH(req: Request, { params }: Ctx) {
  return withOwner(req, async () => {
    const { id } = await params;
    const { password } = Body.parse(await bodyJson(req));
    if (!(await q('SELECT 1 FROM users WHERE id = $1', [id])).length) return Response.json({ error: 'No such user.' }, { status: 404 });
    await setPassword(id, password);
    return Response.json({ ok: true });
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  return withOwner(req, async (me) => {
    const { id } = await params;
    if (id === me.uid) return Response.json({ error: 'You cannot delete your own account.' }, { status: 400 });
    return (await deleteUser(id)) ? Response.json({ ok: true }) : Response.json({ error: 'No such user.' }, { status: 404 });
  });
}
