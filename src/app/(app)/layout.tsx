import { redirect } from 'next/navigation';
import { isLoggedIn } from '@/lib/auth';
import { Nav } from '@/components/Nav';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await isLoggedIn())) redirect('/login');
  return (
    <div className="shell">
      <Nav />
      {children}
    </div>
  );
}
