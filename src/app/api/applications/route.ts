import { withUser } from '@/lib/http';
import { listApplications } from '@/lib/applications';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return withUser(req, async (me) => Response.json({ applications: await listApplications(me.uid) }));
}
