import { withUser } from '@/lib/http';
import { apifyStatus } from '@/lib/users';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return withUser(req, async (me) =>
    Response.json({ username: me.username, isOwner: me.isOwner, apify: await apifyStatus(me.uid) }),
  );
}
