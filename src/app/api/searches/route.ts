import { z } from 'zod';
import { withUser, bodyJson } from '@/lib/http';
import { listSearches, startSearch } from '@/lib/searches';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const Body = z.object({
  keywords: z.string().min(2, 'Enter a role or skills to search for.'),
  location: z.string().default(''),
  remote: z.boolean().default(false),
  days: z.number().int().min(1).max(60).nullable().default(null),
  sources: z.array(z.string()).optional(),
});

export async function GET(req: Request) {
  return withUser(req, async () => Response.json({ searches: await listSearches(15) }));
}

export async function POST(req: Request) {
  return withUser(req, async () => Response.json(await startSearch(Body.parse(await bodyJson(req)))));
}
