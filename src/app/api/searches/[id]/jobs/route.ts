import { withUser } from '@/lib/http';
import { jobIdsForSearch } from '@/lib/searches';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(req, async () => Response.json({ ids: await jobIdsForSearch((await params).id) }));
}
