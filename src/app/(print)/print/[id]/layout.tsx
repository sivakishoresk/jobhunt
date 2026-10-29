import { redirect } from 'next/navigation';
import { isLoggedIn } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  if (!(await isLoggedIn())) redirect('/login');
  return <>{children}</>;
}
