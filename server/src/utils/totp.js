// Two-step sign-in with an authenticator app (RFC 6238 time-based codes) plus one-time recovery codes.
import crypto from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(buf) {
  let bits = ''; let out = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}
const unbase32 = (s) => {
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase()) bits += B32.indexOf(c).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
};

export const newSecret = () => base32(crypto.randomBytes(20));

function hotp(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', unbase32(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, '0');
}

// The code for the current (or a nearby) time step. Used by tests and by the sign-in helper.
export const totpCode = (secret, offset = 0) => hotp(secret, Math.floor(Date.now() / 30000) + offset);

// Returns the time step the code belongs to, or null. A step that was already used (lastStep) is refused, so a code works once.
export function verifyTotp(secret, code, lastStep = 0) {
  const c = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const now = Math.floor(Date.now() / 30000);
  for (const w of [0, -1, 1]) { // one step either side, for clocks that are a little off
    const step = now + w;
    if (step > Number(lastStep) && crypto.timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(c))) return step;
  }
  return null;
}

export const otpauthUrl = (issuer, account, secret) => `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// ---- recovery codes: shown once, stored only as hashes, each works once ----
const norm = (c) => String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const hash = (c) => crypto.createHash('sha256').update(norm(c)).digest('hex');
export function newRecoveryCodes(n = 8) {
  const codes = Array.from({ length: n }, () => { const r = base32(crypto.randomBytes(5)).toLowerCase().slice(0, 8); return `${r.slice(0, 4)}-${r.slice(4)}`; });
  return { codes, hashes: codes.map(hash) };
}
// Returns the remaining hashes if the code was valid, otherwise null.
export function useRecoveryCode(stored, code) {
  const list = JSON.parse(stored || '[]');
  const h = hash(code);
  return list.includes(h) ? list.filter((x) => x !== h) : null;
}

// ---- protecting the secret inside the database (AES-256-GCM, key derived from the site's JWT secret) ----
const key = () => crypto.createHash('sha256').update(`wp-data-key:${process.env.JWT_SECRET}`).digest();
export function encryptText(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `v1:${Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')}`;
}
export function decryptText(stored) {
  if (!stored || !String(stored).startsWith('v1:')) return stored;
  const raw = Buffer.from(String(stored).slice(3), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}
