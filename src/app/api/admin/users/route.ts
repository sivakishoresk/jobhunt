import { withOwner } from '@/lib/http';
import { listUsers } from '@/lib/users';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return withOwner(req, async () => Response.json({ users: await listUsers() }));
}
