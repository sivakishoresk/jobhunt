import { withUser } from '@/lib/http';
import { scopeForSearch } from '@/lib/searches';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(req, async (me) => Response.json(await scopeForSearch(me.uid, (await params).id)));
}
