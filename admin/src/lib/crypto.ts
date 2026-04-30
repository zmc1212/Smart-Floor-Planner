import crypto from 'node:crypto';

const DEFAULT_SECRET = 'smart-floor-planner-pollinations-secret';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getSecret() {
  return process.env.POLLINATIONS_KEY_ENCRYPTION_SECRET || process.env.JWT_SECRET || DEFAULT_SECRET;
}

function getKey() {
  return crypto.createHash('sha256').update(getSecret()).digest();
}

export function encryptText(plainText: string) {
  if (!plainText) {
    return '';
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.');
}

export function decryptText(payload?: string | null) {
  if (!payload) {
    return '';
  }

  const [ivPart, tagPart, encryptedPart] = payload.split('.');
  if (!ivPart || !tagPart || !encryptedPart) {
    throw new Error('Invalid encrypted payload');
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivPart, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, 'base64')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

export function maskSecret(secret?: string | null) {
  if (!secret) {
    return '';
  }

  if (secret.length <= 10) {
    return `${secret.slice(0, 2)}***${secret.slice(-2)}`;
  }

  return `${secret.slice(0, 5)}***${secret.slice(-4)}`;
}
