import { baseUrl } from '@/lib/env';
import { CORS, resourceUrl, SCOPE } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const base = baseUrl(req);
  return Response.json(
    {
      resource: resourceUrl(base),
      authorization_servers: [base],
      bearer_methods_supported: ['header'],
      scopes_supported: [SCOPE],
      resource_name: 'Jobhunt',
    },
    { headers: CORS },
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
