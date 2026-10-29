import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { authenticateMcp } from '@/lib/mcp-auth';
import { createMcpServer } from '@/mcp/server';
import { baseUrl } from '@/lib/env';
import { CORS } from '@/lib/oauth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle(req: Request): Promise<Response> {
  const auth = await authenticateMcp(req);
  if (!auth.ok) return auth.response;

  const server = createMcpServer(baseUrl(req));
  // Stateless: a fresh server and transport per request, so it runs fine on serverless.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const res = await transport.handleRequest(req);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
