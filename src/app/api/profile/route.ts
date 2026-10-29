import { withUser, bodyJson } from '@/lib/http';
import { getProfile, saveProfile } from '@/lib/profile';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return withUser(req, async () => Response.json(await getProfile()));
}

export async function PUT(req: Request) {
  return withUser(req, async () => Response.json(await saveProfile(await bodyJson(req))));
}
