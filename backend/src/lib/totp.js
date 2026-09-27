import crypto from 'node:crypto';

// Two-factor login with an authenticator app (RFC 6238 TOTP: 6 digits, 30s
// steps, SHA-1, which is what Google Authenticator and friends expect).
// Secrets are stored encrypted (AES-256-GCM) with a key from TOTP_KEY, so a
// leaked database alone can't mint codes. Recovery codes are stored hashed.

const STEP_S = 30;
const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of str.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('bad base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function hotp(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 15;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(code).padStart(DIGITS, '0');
}

export const stepAt = (ms) => Math.floor(ms / 1000 / STEP_S);

// The step a code belongs to (allowing one step of clock drift either way),
// or null. Steps at or before `lastStep` are refused, so a code can't be
// replayed once it has been used.
export function verifyTotp(secretB32, code, { lastStep = -1, now = Date.now() } = {}) {
  if (!/^\d{6}$/.test(String(code || ''))) return null;
  const secret = base32Decode(secretB32);
  const current = stepAt(now);
  for (const step of [current - 1, current, current + 1]) {
    if (step > lastStep && crypto.timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(String(code)))) return step;
  }
  return null;
}

export const newSecret = () => base32Encode(crypto.randomBytes(20));

export function otpauthUri(secretB32, account) {
  const label = encodeURIComponent(`AniNest:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=AniNest&algorithm=SHA1&digits=${DIGITS}&period=${STEP_S}`;
}

// ---- Encryption at rest ----

// Without TOTP_KEY, dev and tests use a fixed key; production refuses, so
// secrets are never stored under a key anyone can read in this repo.
function key() {
  const raw = process.env.TOTP_KEY || (process.env.NODE_ENV === 'production' ? '' : 'aninest-dev-only-totp-key');
  return raw ? crypto.createHash('sha256').update(raw).digest() : null;
}
export const totpAvailable = () => Boolean(key());

export function encryptSecret(secretB32) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(secretB32, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decryptSecret(stored) {
  const [iv, tag, data] = stored.split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

// ---- Recovery codes: 10 one-time codes like "k7m2-9qxd" ----

export const hashRecoveryCode = (code) => crypto.createHash('sha256').update(code.toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');

export function newRecoveryCodes() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 10 }, () => {
    const chars = Array.from({ length: 8 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4)}`;
  });
}
