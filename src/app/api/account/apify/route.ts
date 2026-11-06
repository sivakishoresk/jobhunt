import { z } from 'zod';
import { withUser, bodyJson } from '@/lib/http';
import { apifyStatus, setApifyToken } from '@/lib/users';

export const dynamic = 'force-dynamic';

const Body = z.object({ token: z.string().trim().min(10, 'That does not look like an Apify token.').max(300) });

export async function PUT(req: Request) {
  return withUser(req, async (me) => {
    const { token } = Body.parse(await bodyJson(req));
    await setApifyToken(me.uid, token);
    return Response.json({ apify: await apifyStatus(me.uid) });
  });
}

export async function DELETE(req: Request) {
  return withUser(req, async (me) => {
    await setApifyToken(me.uid, null);
    return Response.json({ apify: await apifyStatus(me.uid) });
  });
}
