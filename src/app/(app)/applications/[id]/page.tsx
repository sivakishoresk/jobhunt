import { AppEditor } from '@/components/AppEditor';

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AppEditor id={id} />;
}
