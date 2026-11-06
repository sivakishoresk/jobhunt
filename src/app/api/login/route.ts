import { cookies } from 'next/headers';
import { clearAttempts, clientIp, createSessionCookie, recordAttempt, sameOriginOk, tooMany } from '@/lib/auth';
import { normalizeUsername, verifyLogin } from '@/lib/users';
import { errMessage } from '@/lib/util';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    if (!(await sameOriginOk(req))) return Response.json({ error: 'Cross-site request blocked.' }, { status: 403 });
    const body = (await req.json().catch(() => ({}))) as { username?: string; password?: string };
    const username = normalizeUsername(String(body.username ?? ''));
    const password = String(body.password ?? '');
    if (!username || !password) return Response.json({ error: 'Enter your username and password.' }, { status: 400 });
    const ipKey = `ip:${clientIp(req.headers)}`;
    const userKey = `user:${username.slice(0, 60)}`;
    if ((await tooMany(ipKey, 20)) || (await tooMany(userKey, 8))) {
      return Response.json({ error: 'Too many wrong attempts. Wait 15 minutes and try again.' }, { status: 429 });
    }
    const user = password.length > 200 ? null : await verifyLogin(username, password);
    if (!user) {
      await recordAttempt(ipKey);
      await recordAttempt(userKey);
      return Response.json({ error: 'That username and password do not match.' }, { status: 401 });
    }
    await clearAttempts(userKey);
    const c = await createSessionCookie(user);
    (await cookies()).set(c.name, c.value, c.options as any);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: errMessage(e) }, { status: 500 });
  }
}
