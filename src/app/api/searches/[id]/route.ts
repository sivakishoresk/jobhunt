import { withUser } from '@/lib/http';
import { advanceSearch } from '@/lib/searches';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(req, async (me) => Response.json(await advanceSearch(me.uid, (await params).id)));
}
