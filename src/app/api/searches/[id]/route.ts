import { withUser } from '@/lib/http';
import { advanceSearch } from '@/lib/searches';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(req, async () => Response.json(await advanceSearch((await params).id)));
}
