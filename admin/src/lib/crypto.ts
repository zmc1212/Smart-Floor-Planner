import crypto from 'node:crypto';

const DEFAULT_SECRET = 'smart-floor-planner-pollinations-secret';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getSecret() {
  return process.env.AI_PROVIDER_KEY_ENCRYPTION_SECRET || process.env.POLLINATIONS_KEY_ENCRYPTION_SECRET || process.env.JWT_SECRET || DEFAULT_SECRET;
}

function getKey(secret = getSecret()) {
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptWithSecret(plainText: string, secret: string) {
  if (!plainText) {
    return '';
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.');
}

function decryptWithSecret(payload: string | null | undefined, secret: string) {
  if (!payload) {
    return '';
  }

  const [ivPart, tagPart, encryptedPart] = payload.split('.');
  if (!ivPart || !tagPart || !encryptedPart) {
    throw new Error('Invalid encrypted payload');
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getKey(secret),
    Buffer.from(ivPart, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, 'base64')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

export function encryptText(plainText: string) {
  return encryptWithSecret(plainText, getSecret());
}

export function decryptText(payload?: string | null) {
  return decryptWithSecret(payload, getSecret());
}

function getMediaStorageSecret() {
  const dedicatedSecret = process.env.MEDIA_STORAGE_KEY_ENCRYPTION_SECRET?.trim();
  if (!dedicatedSecret && process.env.NODE_ENV === 'production') {
    throw new Error('生产环境必须配置 MEDIA_STORAGE_KEY_ENCRYPTION_SECRET');
  }
  return dedicatedSecret
    || process.env.AI_PROVIDER_KEY_ENCRYPTION_SECRET?.trim()
    || process.env.JWT_SECRET?.trim()
    || DEFAULT_SECRET;
}

export function encryptMediaStorageSecret(plainText: string) {
  return encryptWithSecret(plainText, getMediaStorageSecret());
}

export function decryptMediaStorageSecret(payload?: string | null) {
  return decryptWithSecret(payload, getMediaStorageSecret());
}

export function isMediaStorageEncryptionReady() {
  return process.env.NODE_ENV === 'production'
    ? Boolean(process.env.MEDIA_STORAGE_KEY_ENCRYPTION_SECRET?.trim())
    : true;
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
