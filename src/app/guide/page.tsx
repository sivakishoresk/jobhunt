import type { Metadata } from 'next';
import { getSession } from '@/lib/auth';
import { GuideView } from '@/components/GuideView';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Guide · Jobhunt',
  description: 'Set up Jobhunt, connect Claude, and try every step with worked examples.',
};

export default async function GuidePage() {
  const me = await getSession();
  return <GuideView username={me?.username ?? null} />;
}
