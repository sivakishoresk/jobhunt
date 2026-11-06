import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

export function sha256hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** An error with an HTTP status the API should answer with. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}
