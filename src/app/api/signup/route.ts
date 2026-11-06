import { cookies } from 'next/headers';
import { clientIp, createSessionCookie, recordAttempt, sameOriginOk, tooMany } from '@/lib/auth';
import { checkNewCredentials, createUser, normalizeUsername } from '@/lib/users';
import { env } from '@/lib/env';
import { errMessage } from '@/lib/util';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    if (env('ALLOW_SIGNUP').toLowerCase() === 'false') {
      return Response.json({ error: 'New accounts are turned off. Contact SK.' }, { status: 403 });
    }
    if (!(await sameOriginOk(req))) return Response.json({ error: 'Cross-site request blocked.' }, { status: 403 });
    const body = (await req.json().catch(() => ({}))) as { username?: string; password?: string };
    const username = normalizeUsername(String(body.username ?? ''));
    const password = String(body.password ?? '');
    const problem = checkNewCredentials(username, password);
    if (problem) return Response.json({ error: problem }, { status: 400 });
    const key = `signup:${clientIp(req.headers)}`;
    if (await tooMany(key, 5, 60)) return Response.json({ error: 'Too many accounts created from this network. Try again in an hour.' }, { status: 429 });
    const user = await createUser(username, password).catch((e) => {
      throw Object.assign(new Error(errMessage(e)), { taken: true });
    });
    await recordAttempt(key);
    const c = await createSessionCookie(user);
    (await cookies()).set(c.name, c.value, c.options as any);
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ error: errMessage(e) }, { status: e?.taken ? 409 : 500 });
  }
}
