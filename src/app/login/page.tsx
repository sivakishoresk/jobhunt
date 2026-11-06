import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { env } from '@/lib/env';
import { LoginForm } from '@/components/LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await getSession()) redirect('/');
  return <LoginForm signupOpen={env('ALLOW_SIGNUP').toLowerCase() !== 'false'} />;
}
