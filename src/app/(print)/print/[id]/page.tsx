import { notFound } from 'next/navigation';
import { getApplication } from '@/lib/applications';
import { LetterSheet, ResumeSheet, letterDate } from '@/components/sheets';
import { PrintBar } from '@/components/PrintBar';

export const dynamic = 'force-dynamic';

export default async function PrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ doc?: string; auto?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const app = await getApplication(id);
  if (!app) notFound();
  const cover = sp.doc === 'cover';
  return (
    <div style={{ padding: '1rem' }}>
      <PrintBar auto={sp.auto === '1'} id={id} cover={cover} />
      {cover ? (
        <LetterSheet name={app.resume.name} contact={app.resume.contact} date={letterDate(app.updated_at)} company={app.company} body={app.cover_letter} />
      ) : (
        <ResumeSheet doc={app.resume} />
      )}
    </div>
  );
}
