import { randomBytes, createHmac, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT_KEYLEN = 64;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function sign(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

// Token sesi mandiri (stateless) agar request berikutnya tetap sah walau
// ditangani instance serverless yang berbeda. Format: v1.<payload>.<sig>
export function createSessionToken(userId, expiresAt, secret) {
  const payload = Buffer.from(
    JSON.stringify({ uid: Number(userId), exp: Number(expiresAt) }),
  ).toString('base64url');
  return `v1.${payload}.${sign(payload, secret)}`;
}

export function readSessionToken(token, secret) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const payload = parts[1];
  const signature = parts[2];
  if (!safeEqual(signature, sign(payload, secret))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!Number.isInteger(data.uid) || !Number.isFinite(data.exp)) return null;
    if (data.exp < Date.now()) return null;
    return { userId: data.uid, expiresAt: data.exp };
  } catch {
    return null;
  }
}
