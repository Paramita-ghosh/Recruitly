import crypto from 'node:crypto';
import env from '../config/env.js';

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

const key = () =>
  crypto.createHash('sha256').update(env.TOKEN_ENC_KEY || `enc:${env.JWT_SECRET}`).digest();

/** AES-256-GCM. Used for OAuth tokens stored at rest. */
export function encrypt(plain) {
  if (plain == null) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

export function decrypt(blob) {
  if (!blob) return null;
  const raw = Buffer.from(blob, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}
