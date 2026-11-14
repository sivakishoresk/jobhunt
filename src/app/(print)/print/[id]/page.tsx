import { notFound } from 'next/navigation';
import { getApplication } from '@/lib/applications';
import { letterDate } from '@/components/sheets';
import { LetterSheet, ResumeSheet } from '@/components/Paged';
import { PrintLinks } from '@/components/PrintBar';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function PrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ doc?: string; auto?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await getSession();
  const app = me ? await getApplication(me.uid, id) : null;
  if (!app) notFound();
  const cover = sp.doc === 'cover';
  const auto = sp.auto === '1';
  const links = <PrintLinks id={id} cover={cover} />;
  return (
    <div className="printwrap">
      {cover ? (
        <LetterSheet printable autoPrint={auto} pdf={{ id, doc: 'cover' }} name={app.resume.name} contact={app.resume.contact} date={letterDate(app.updated_at)} company={app.company} body={app.cover_letter}>
          {links}
        </LetterSheet>
      ) : (
        <ResumeSheet printable autoPrint={auto} storeKey={id} pdf={{ id, doc: 'resume' }} doc={app.resume}>
          {links}
        </ResumeSheet>
      )}
    </div>
  );
}
