import { cookies } from 'next/headers';
import { z } from 'zod';
import { withUser, bodyJson } from '@/lib/http';
import { clearAttempts, createSessionCookie, recordAttempt, tooMany } from '@/lib/auth';
import { checkNewCredentials, checkPassword, getUserById, setPassword } from '@/lib/users';

export const dynamic = 'force-dynamic';

const Body = z.object({ current: z.string().max(200), next: z.string().max(200) });

export async function POST(req: Request) {
  return withUser(req, async (me) => {
    const { current, next } = Body.parse(await bodyJson(req));
    const key = `pw:${me.uid}`;
    if (await tooMany(key, 8)) return Response.json({ error: 'Too many wrong attempts. Wait 15 minutes.' }, { status: 429 });
    if (!(await checkPassword(me.uid, current))) {
      await recordAttempt(key);
      return Response.json({ error: 'Your current password is not right.' }, { status: 400 });
    }
    await clearAttempts(key);
    const problem = checkNewCredentials(me.username, next);
    if (problem && !problem.startsWith('Username')) return Response.json({ error: problem }, { status: 400 });
    await setPassword(me.uid, next);
    // The password changed, so every other session and Claude connection stops working; keep this one.
    const user = await getUserById(me.uid);
    if (user) {
      const c = await createSessionCookie(user);
      (await cookies()).set(c.name, c.value, c.options as any);
    }
    return Response.json({ ok: true });
  });
}
