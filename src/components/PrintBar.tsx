import Link from 'next/link';

/** The links beside the print button. Printing itself, and the page check, live in Paged. */
export function PrintLinks({ id, cover }: { id: string; cover: boolean }) {
  return (
    <>
      <Link className="btn" href={`/print/${id}?doc=${cover ? 'resume' : 'cover'}`}>
        Show the {cover ? 'resume' : 'cover letter'}
      </Link>
      <Link className="btn quiet" href={`/applications/${id}`}>
        Back to the application
      </Link>
    </>
  );
}
