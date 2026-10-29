import { cookies } from 'next/headers';
import { clientIp, createSessionCookie, passwordMatches, recordFailure, tooManyAttempts } from '@/lib/auth';
import { errMessage } from '@/lib/util';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const ip = clientIp(req.headers);
    if (await tooManyAttempts(ip)) {
      return Response.json({ error: 'Too many wrong passwords. Wait 15 minutes and try again.' }, { status: 429 });
    }
    const { password } = (await req.json().catch(() => ({}))) as { password?: string };
    if (!passwordMatches(String(password ?? ''))) {
      await recordFailure(ip);
      return Response.json({ error: 'That password is not right.' }, { status: 401 });
    }
    const c = await createSessionCookie();
    (await cookies()).set(c.name, c.value, c.options as any);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: errMessage(e) }, { status: 500 });
  }
}
