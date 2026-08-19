import crypto from 'node:crypto';

const TOKEN_PREFIX = 'prs_';
const ACTIVITY_TOKEN_PREFIX = 'pas_';
const DEFAULT_TTL_SECONDS = 10 * 60;

export interface PendingReferralSourceInput {
  promotionCodeId: bigint;
  membershipId: bigint;
  version: number;
}

export interface PendingReferralSource extends PendingReferralSourceInput {
  kind?: 'referrer';
  expiresAt: Date;
  expired: boolean;
}

export interface PendingStaffActivitySourceInput {
  activityCodeId: bigint;
  staffId: bigint;
  enterpriseId: bigint;
  version: number;
}

export interface PendingStaffActivitySource extends PendingStaffActivitySourceInput {
  kind: 'staff_activity';
  expiresAt: Date;
  expired: boolean;
}

export type PendingClaimSource = PendingReferralSource | PendingStaffActivitySource;

function sourceSecret() {
  const configured =
    process.env.REFERRER_PENDING_SOURCE_SECRET ||
    process.env.REFERRER_TOKEN_SECRET ||
    process.env.JWT_SECRET;
  if (
    process.env.NODE_ENV === 'production' &&
    (!configured || Buffer.byteLength(configured, 'utf8') < 16)
  ) {
    throw new Error(
      'REFERRER_PENDING_SOURCE_SECRET, REFERRER_TOKEN_SECRET, or JWT_SECRET must contain at least 128 bits'
    );
  }
  return configured || 'local_referral_pending_source_secret_32_bytes';
}

function encryptionKey() {
  return crypto.createHash('sha256').update(sourceSecret(), 'utf8').digest();
}

export function sealPendingReferralSource(
  input: PendingReferralSourceInput,
  options: { now?: Date; ttlSeconds?: number } = {}
) {
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new Error('Pending referral source version must be positive');
  }
  const now = options.now ?? new Date();
  const ttlSeconds = Math.max(
    30,
    Math.min(options.ttlSeconds ?? DEFAULT_TTL_SECONDS, 60 * 60)
  );
  const expiresAt = Math.floor(now.getTime() / 1000) + ttlSeconds;
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), nonce);
  cipher.setAAD(Buffer.from('smart-floor-planner:pending-referral:v1'));
  const plaintext = JSON.stringify({
    p: input.promotionCodeId.toString(),
    m: input.membershipId.toString(),
    v: input.version,
    e: expiresAt,
  });
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${TOKEN_PREFIX}${Buffer.concat([nonce, tag, ciphertext]).toString('base64url')}`;
}

export function openPendingReferralSource(
  token: unknown,
  options: { now?: Date } = {}
): PendingReferralSource | null {
  if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX)) return null;
  const encoded = token.slice(TOKEN_PREFIX.length);
  if (!/^[A-Za-z0-9_-]{40,512}$/.test(encoded)) return null;

  try {
    const packed = Buffer.from(encoded, 'base64url');
    if (packed.length < 12 + 16 + 2) return null;
    const nonce = packed.subarray(0, 12);
    const tag = packed.subarray(12, 28);
    const ciphertext = packed.subarray(28);
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      nonce
    );
    decipher.setAuthTag(tag);
    decipher.setAAD(Buffer.from('smart-floor-planner:pending-referral:v1'));
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
    const parsed = JSON.parse(plaintext) as Record<string, unknown>;
    if (
      typeof parsed.p !== 'string' ||
      !/^[1-9]\d*$/.test(parsed.p) ||
      typeof parsed.m !== 'string' ||
      !/^[1-9]\d*$/.test(parsed.m) ||
      !Number.isInteger(parsed.v) ||
      Number(parsed.v) < 1 ||
      !Number.isInteger(parsed.e) ||
      Number(parsed.e) < 1
    ) {
      return null;
    }
    const expiresAt = new Date(Number(parsed.e) * 1000);
    const now = options.now ?? new Date();
    return {
      kind: 'referrer',
      promotionCodeId: BigInt(parsed.p),
      membershipId: BigInt(parsed.m),
      version: Number(parsed.v),
      expiresAt,
      expired: expiresAt.getTime() <= now.getTime(),
    };
  } catch {
    return null;
  }
}

export function sealPendingStaffActivitySource(
  input: PendingStaffActivitySourceInput,
  options: { now?: Date; ttlSeconds?: number } = {}
) {
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new Error('Pending staff activity source version must be positive');
  }
  const now = options.now ?? new Date();
  const ttlSeconds = Math.max(
    30,
    Math.min(options.ttlSeconds ?? DEFAULT_TTL_SECONDS, 60 * 60)
  );
  const expiresAt = Math.floor(now.getTime() / 1000) + ttlSeconds;
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), nonce);
  cipher.setAAD(Buffer.from('smart-floor-planner:pending-activity:v1'));
  const plaintext = JSON.stringify({
    c: input.activityCodeId.toString(),
    s: input.staffId.toString(),
    n: input.enterpriseId.toString(),
    v: input.version,
    e: expiresAt,
  });
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${ACTIVITY_TOKEN_PREFIX}${Buffer.concat([nonce, tag, ciphertext]).toString('base64url')}`;
}

export function openPendingStaffActivitySource(
  token: unknown,
  options: { now?: Date } = {}
): PendingStaffActivitySource | null {
  if (typeof token !== 'string' || !token.startsWith(ACTIVITY_TOKEN_PREFIX)) return null;
  const encoded = token.slice(ACTIVITY_TOKEN_PREFIX.length);
  if (!/^[A-Za-z0-9_-]{40,512}$/.test(encoded)) return null;

  try {
    const packed = Buffer.from(encoded, 'base64url');
    if (packed.length < 12 + 16 + 2) return null;
    const nonce = packed.subarray(0, 12);
    const tag = packed.subarray(12, 28);
    const ciphertext = packed.subarray(28);
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      nonce
    );
    decipher.setAuthTag(tag);
    decipher.setAAD(Buffer.from('smart-floor-planner:pending-activity:v1'));
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
    const parsed = JSON.parse(plaintext) as Record<string, unknown>;
    if (
      typeof parsed.c !== 'string' ||
      !/^[1-9]\d*$/.test(parsed.c) ||
      typeof parsed.s !== 'string' ||
      !/^[1-9]\d*$/.test(parsed.s) ||
      typeof parsed.n !== 'string' ||
      !/^[1-9]\d*$/.test(parsed.n) ||
      !Number.isInteger(parsed.v) ||
      Number(parsed.v) < 1 ||
      !Number.isInteger(parsed.e) ||
      Number(parsed.e) < 1
    ) {
      return null;
    }
    const expiresAt = new Date(Number(parsed.e) * 1000);
    const now = options.now ?? new Date();
    return {
      kind: 'staff_activity',
      activityCodeId: BigInt(parsed.c),
      staffId: BigInt(parsed.s),
      enterpriseId: BigInt(parsed.n),
      version: Number(parsed.v),
      expiresAt,
      expired: expiresAt.getTime() <= now.getTime(),
    };
  } catch {
    return null;
  }
}

export function openPendingClaimSource(
  token: unknown,
  options: { now?: Date } = {}
): PendingClaimSource | null {
  return openPendingReferralSource(token, options) ?? openPendingStaffActivitySource(token, options);
}

export function hashReferralIdempotencyKey(value: string) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function normalizeReferralIdempotencyKey(value: unknown) {
  const key = typeof value === 'string' ? value.trim() : '';
  return key.length >= 8 && key.length <= 160 ? key : null;
}

export const pendingReferralSourceTtlSeconds = DEFAULT_TTL_SECONDS;
