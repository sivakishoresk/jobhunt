import { Fragment, type ReactNode } from 'react';

/** Turns **text** into <strong>. Plain function so server and client components can both use it. */
export function renderBold(text: string): ReactNode {
  return text.split(/\*\*(.+?)\*\*/g).map((p, i) => (i % 2 === 1 ? <strong key={i}>{p}</strong> : <Fragment key={i}>{p}</Fragment>));
}
