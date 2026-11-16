import crypto from 'node:crypto';

const DEV_CREDENTIAL_SECRET = 'local-dev-credential-encryption-only';
const LEGACY_DEFAULT_SECRET = 'smart-floor-planner-pollinations-secret';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const PLACEHOLDER = /(replace|your_|example|change_me|placeholder)/i;

export class CredentialEncryptionError extends Error {
  constructor(readonly code: 'credential_encryption_secret_missing' | 'credential_encryption_secret_invalid' | 'credential_decryption_failed') {
    super(
      code === 'credential_encryption_secret_missing'
        ? '生产环境必须配置 AI_PROVIDER_KEY_ENCRYPTION_SECRET'
        : code === 'credential_encryption_secret_invalid'
          ? 'AI_PROVIDER_KEY_ENCRYPTION_SECRET 不能使用占位值、默认值或短密钥'
          : '凭据解密失败'
    );
    this.name = 'CredentialEncryptionError';
  }
}

function primaryCredentialSecret(env: NodeJS.ProcessEnv = process.env): string {
  const dedicated = env.AI_PROVIDER_KEY_ENCRYPTION_SECRET?.trim();
  if (dedicated) {
    if (
      env.NODE_ENV === 'production'
      && (dedicated.length < 32 || PLACEHOLDER.test(dedicated)
        || dedicated === LEGACY_DEFAULT_SECRET || dedicated === env.JWT_SECRET?.trim())
    ) {
      throw new CredentialEncryptionError('credential_encryption_secret_invalid');
    }
    return dedicated;
  }
  if (env.NODE_ENV === 'production') {
    throw new CredentialEncryptionError('credential_encryption_secret_missing');
  }
  return env.POLLINATIONS_KEY_ENCRYPTION_SECRET?.trim()
    || env.JWT_SECRET?.trim()
    || DEV_CREDENTIAL_SECRET;
}

/**
 * Read-only compatibility for ciphertext written before the dedicated
 * AI_PROVIDER_KEY_ENCRYPTION_SECRET existed. Production may read old
 * POLLINATIONS/JWT ciphertext, but never the old fixed default secret.
 */
function legacyCredentialSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  const secrets = [
    env.AI_PROVIDER_KEY_ENCRYPTION_SECRET_PREVIOUS?.trim(),
    env.POLLINATIONS_KEY_ENCRYPTION_SECRET?.trim(),
    env.JWT_SECRET_PREVIOUS?.trim(),
    env.JWT_SECRET?.trim(),
  ];
  if (env.NODE_ENV !== 'production') secrets.push(LEGACY_DEFAULT_SECRET);
  return [...new Set(secrets.filter((value): value is string => Boolean(value)))];
}

function getKey(secret: string) {
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

function decryptWithSecret(payload: string, secret: string) {
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
  return encryptWithSecret(plainText, primaryCredentialSecret());
}

export function decryptText(payload?: string | null) {
  if (!payload) {
    return '';
  }

  const candidates = [...new Set([primaryCredentialSecret(), ...legacyCredentialSecrets()])];
  for (const secret of candidates) {
    try {
      return decryptWithSecret(payload, secret);
    } catch {
      // Try the next read-only compatibility secret.
    }
  }
  throw new CredentialEncryptionError('credential_decryption_failed');
}

export function isCredentialEncryptionReady(env: NodeJS.ProcessEnv = process.env) {
  try {
    primaryCredentialSecret(env);
    return true;
  } catch {
    return false;
  }
}

function getMediaStorageSecret() {
  const dedicatedSecret = process.env.MEDIA_STORAGE_KEY_ENCRYPTION_SECRET?.trim();
  if (!dedicatedSecret && process.env.NODE_ENV === 'production') {
    throw new Error('生产环境必须配置 MEDIA_STORAGE_KEY_ENCRYPTION_SECRET');
  }
  return dedicatedSecret
    || process.env.AI_PROVIDER_KEY_ENCRYPTION_SECRET?.trim()
    || process.env.JWT_SECRET?.trim()
    || DEV_CREDENTIAL_SECRET;
}

/**
 * Read-only candidates for media credentials written before the dedicated
 * media key existed or before a rotation. Encryption always uses the primary
 * secret; only decryption walks this list, mirroring AI provider credentials.
 */
function legacyMediaStorageSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  const secrets = [
    env.MEDIA_STORAGE_KEY_ENCRYPTION_SECRET_PREVIOUS?.trim(),
    env.AI_PROVIDER_KEY_ENCRYPTION_SECRET?.trim(),
    env.AI_PROVIDER_KEY_ENCRYPTION_SECRET_PREVIOUS?.trim(),
    env.JWT_SECRET?.trim(),
    env.JWT_SECRET_PREVIOUS?.trim(),
  ];
  if (env.NODE_ENV !== 'production') secrets.push(LEGACY_DEFAULT_SECRET);
  return [...new Set(secrets.filter((value): value is string => Boolean(value)))];
}

export function encryptMediaStorageSecret(plainText: string) {
  return encryptWithSecret(plainText, getMediaStorageSecret());
}

export function decryptMediaStorageSecret(payload?: string | null) {
  if (!payload) return '';
  const candidates = [...new Set([getMediaStorageSecret(), ...legacyMediaStorageSecrets()])];
  for (const secret of candidates) {
    try {
      return decryptWithSecret(payload, secret);
    } catch {
      // Try the next read-only compatibility secret.
    }
  }
  throw new Error('媒体存储凭据解密失败');
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
