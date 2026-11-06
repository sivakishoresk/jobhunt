import { ZodError } from 'zod';
import { guard, type Session } from './auth';
import { errMessage, HttpError } from './util';

export async function withUser(req: Request, fn: (me: Session) => Promise<Response>): Promise<Response> {
  const g = await guard(req);
  if ('denied' in g) return g.denied;
  try {
    return await fn(g.session);
  } catch (e) {
    if (e instanceof ZodError) {
      const first = e.issues[0];
      return Response.json({ error: `${first.path.join('.') || 'input'}: ${first.message}` }, { status: 400 });
    }
    if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: errMessage(e) }, { status: 500 });
  }
}

export async function withOwner(req: Request, fn: (me: Session) => Promise<Response>): Promise<Response> {
  return withUser(req, async (me) => (me.isOwner ? fn(me) : Response.json({ error: 'Only the owner can do this.' }, { status: 403 })));
}

export async function bodyJson<T = any>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new Error('Request body must be JSON.');
  }
}
