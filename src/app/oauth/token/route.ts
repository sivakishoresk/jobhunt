import { exchange, CORS } from '@/lib/oauth';
import { baseUrl } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const raw = await req.text();
  const form = new URLSearchParams(raw);
  let basic: { id: string; secret: string } | undefined;
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('basic ')) {
    const [id, ...rest] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
    basic = { id: decodeURIComponent(id), secret: decodeURIComponent(rest.join(':')) };
  }
  const r = await exchange(form, baseUrl(req), basic);
  const headers = { ...CORS, 'Cache-Control': 'no-store', Pragma: 'no-cache' };
  if (!r.ok) {
    return Response.json({ error: r.error, error_description: r.description }, { status: r.error === 'invalid_client' ? 401 : 400, headers });
  }
  return Response.json(r.body, { headers });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
