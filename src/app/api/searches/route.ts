import { z } from 'zod';
import { withUser, bodyJson } from '@/lib/http';
import { listSearches, startSearch } from '@/lib/searches';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const Body = z.object({
  keywords: z.array(z.string().trim().min(2)).min(1, 'Enter a role or skills to search for.').max(5),
  location: z.array(z.string().trim()).max(5).default([]),
  remote: z.boolean().default(false),
  days: z.number().int().min(1).max(60).nullable().default(null),
  experience: z.array(z.number().int().min(1).max(6)).max(6).default([]),
  sources: z.array(z.string()).optional(),
});

export async function GET(req: Request) {
  return withUser(req, async (me) => Response.json({ searches: await listSearches(me.uid, 30) }));
}

export async function POST(req: Request) {
  return withUser(req, async (me) => Response.json(await startSearch(me.uid, Body.parse(await bodyJson(req)))));
}
