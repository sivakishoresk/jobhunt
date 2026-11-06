import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const PARAMS: ScryptOptions = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize('NFKC'), salt, KEYLEN, PARAMS, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** "s1$<salt>$<hash>", base64. Slow on purpose. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `s1$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [v, s, h] = stored.split('$');
  if (v !== 's1' || !s || !h) return false;
  const want = Buffer.from(h, 'base64');
  const got = await derive(password, Buffer.from(s, 'base64'));
  return want.length === got.length && timingSafeEqual(want, got);
}

// Hash of a password nobody has, so a login for an unknown username takes as long as a real one.
let dummy: Promise<string> | null = null;
export async function burnTime(password: string): Promise<void> {
  dummy ??= hashPassword('not-a-real-password');
  await verifyPassword(password, await dummy);
}
