import { ZodError } from 'zod';
import { guard } from './auth';
import { errMessage } from './util';

export async function withUser(req: Request, fn: () => Promise<Response>): Promise<Response> {
  const denied = await guard(req);
  if (denied) return denied;
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ZodError) {
      const first = e.issues[0];
      return Response.json({ error: `${first.path.join('.') || 'input'}: ${first.message}` }, { status: 400 });
    }
    return Response.json({ error: errMessage(e) }, { status: 500 });
  }
}

export async function bodyJson<T = any>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new Error('Request body must be JSON.');
  }
}
