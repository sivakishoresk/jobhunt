import { registerClient, CORS } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let meta: Record<string, unknown> = {};
  try {
    meta = await req.json();
  } catch {
    return Response.json({ error: 'invalid_client_metadata', error_description: 'Body must be JSON.' }, { status: 400, headers: CORS });
  }
  const r = await registerClient(meta as { client_name?: string; redirect_uris?: unknown });
  if (!r.ok) {
    return Response.json({ error: 'invalid_redirect_uri', error_description: r.error }, { status: 400, headers: CORS });
  }
  return Response.json(
    {
      client_id: r.client_id,
      client_name: r.name,
      redirect_uris: r.redirect_uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    { status: 201, headers: CORS },
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
