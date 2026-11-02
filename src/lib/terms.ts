/** Roles and places are stored as lists now; older saved searches hold a single string. */
export function termsText(v: string | string[] | undefined | null, sep = ', '): string {
  return (Array.isArray(v) ? v : [v ?? '']).map((x) => x.trim()).filter(Boolean).join(sep);
}
