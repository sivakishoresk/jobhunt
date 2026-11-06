import { withUser, bodyJson } from '@/lib/http';
import { getProfile, saveProfile } from '@/lib/profile';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return withUser(req, async (me) => Response.json(await getProfile(me.uid)));
}

export async function PUT(req: Request) {
  return withUser(req, async (me) => Response.json(await saveProfile(me.uid, await bodyJson(req))));
}
