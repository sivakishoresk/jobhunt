import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Nav } from '@/components/Nav';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getSession();
  if (!me) redirect('/login');
  return (
    <div className="shell">
      <Nav username={me.username} />
      {children}
    </div>
  );
}
