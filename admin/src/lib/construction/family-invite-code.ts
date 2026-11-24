import { createHmac, timingSafeEqual } from 'node:crypto';
import { getJwtSecretString } from '@/lib/jwt-secret';

/**
 * A family invitation has to fit inside a Mini Program code `scene`, which is
 * limited to 32 characters. The signed share token is a JWT and cannot be used
 * there, so the code carries a compact, self-contained invitation:
 *
 *   f1.<projectId>.<expiresAtInSecondsBase36>.<hmac12>
 *
 * The project, owner and enterprise are re-read from the database when the code
 * is accepted, so the code stays tenant-safe even though it only names a project.
 */
const CODE_PREFIX = 'f1';
const CODE_PATTERN = /^f1\.([1-9]\d{0,8})\.([0-9a-z]{1,8})\.([A-Za-z0-9_-]{12})$/;
export const FAMILY_INVITE_CODE_TTL_SECONDS = 7 * 24 * 60 * 60;

function signature(projectId: string, expiresAt: number) {
  return createHmac('sha256', getJwtSecretString())
    .update(`${CODE_PREFIX}:${projectId}:${expiresAt}`)
    .digest('base64url')
    .slice(0, 12);
}

export function signFamilyInviteCode(projectId: string, options: { now?: number } = {}) {
  if (!/^[1-9]\d{0,8}$/.test(projectId)) throw new Error('Invalid family invite project');
  const expiresAt = Math.floor((options.now ?? Date.now()) / 1000) + FAMILY_INVITE_CODE_TTL_SECONDS;
  const code = `${CODE_PREFIX}.${projectId}.${expiresAt.toString(36)}.${signature(projectId, expiresAt)}`;
  if (code.length > 32) throw new Error('Family invite code exceeds the Mini Program scene limit');
  return { code, expiresAt: new Date(expiresAt * 1000).toISOString() };
}

/** Codes are untrusted input; an invalid, expired or tampered code is a rejection. */
export function verifyFamilyInviteCode(code: string, options: { now?: number } = {}) {
  const match = CODE_PATTERN.exec(String(code || ''));
  if (!match) return null;
  const [, projectId, encodedExpiresAt, given] = match;
  const expiresAt = parseInt(encodedExpiresAt, 36);
  if (!Number.isSafeInteger(expiresAt) || expiresAt * 1000 <= (options.now ?? Date.now())) return null;
  const expected = signature(projectId, expiresAt);
  const givenBytes = Buffer.from(given);
  const expectedBytes = Buffer.from(expected);
  if (givenBytes.length !== expectedBytes.length || !timingSafeEqual(givenBytes, expectedBytes)) return null;
  return { projectId, expiresAt: new Date(expiresAt * 1000).toISOString() };
}
