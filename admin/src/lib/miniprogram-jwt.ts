import { randomUUID } from 'node:crypto';
import * as jose from 'jose';
import { getJwtSecret, JwtSecretUnavailableError } from './jwt-secret';

export interface MiniProgramJWTPayload extends jose.JWTPayload {
  sub: string;           // Base user ID
  id: string;            // Compatibility alias for the base user ID
  mode: 'customer' | 'staff' | 'referrer';
  role: 'staff' | 'user' | 'super_admin' | 'admin' | 'enterprise_admin' | 'designer' | 'salesperson' | 'measurer' | 'construction_staff' | 'viewer';
  staffRole?: string;    // Specific role if staff
  enterpriseId?: string; // Enterprise context
  staffId?: string;
  referrerMembershipId?: string;
  contextVersion: number;
  source: 'wechat' | 'password' | 'phone';
  mustChangePassword?: boolean;
}

/**
 * Sign a token for the Mini Program
 * Default expiration: 21 days
 */
export async function signMiniProgramToken(payload: MiniProgramJWTPayload): Promise<string> {
  return await new jose.SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setAudience('miniprogram')
    .setExpirationTime('21d')
    .sign(getJwtSecret());
}

export interface FamilyInvitePayload extends jose.JWTPayload {
  kind: 'construction-family-invite';
  projectId: string;
  ownerId: string;
  enterpriseId: string;
  jti: string;
}

const familyInviteAudience = 'construction-family-invite';
const familyInviteTtlSeconds = 7 * 24 * 60 * 60;

/** Short-lived, single-use invitation shared by the primary customer. */
export async function signFamilyInvite(input: {
  projectId: string;
  ownerId: string;
  enterpriseId: string;
}): Promise<{ token: string; expiresAt: string }> {
  const jti = randomUUID();
  const token = await new jose.SignJWT({
    kind: 'construction-family-invite',
    projectId: input.projectId,
    ownerId: input.ownerId,
    enterpriseId: input.enterpriseId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(input.ownerId)
    .setJti(jti)
    .setAudience(familyInviteAudience)
    .setIssuedAt()
    .setExpirationTime(`${familyInviteTtlSeconds}s`)
    .sign(getJwtSecret());
  return { token, expiresAt: new Date(Date.now() + familyInviteTtlSeconds * 1000).toISOString() };
}

export async function verifyFamilyInvite(token: string): Promise<FamilyInvitePayload | null> {
  try {
    const { payload } = await jose.jwtVerify(token, getJwtSecret(), {
      audience: familyInviteAudience,
    });
    const id = (value: unknown) => typeof value === 'string' && /^[1-9]\d*$/.test(value);
    if (
      payload.kind !== 'construction-family-invite' ||
      !id(payload.projectId) ||
      !id(payload.ownerId) ||
      !id(payload.enterpriseId) ||
      typeof payload.jti !== 'string' ||
      !payload.jti
    ) {
      return null;
    }
    return payload as FamilyInvitePayload;
  } catch {
    // Shared cards are untrusted input; an invalid, expired or tampered token is
    // an ordinary rejection, not a server error.
    return null;
  }
}

/**
 * Verify a Mini Program token
 */
export async function verifyMiniProgramToken(token: string): Promise<MiniProgramJWTPayload | null> {
  try {
    const { payload } = await jose.jwtVerify(token, getJwtSecret(), {
      audience: 'miniprogram',
    });
    if (
      typeof payload.sub !== 'string' ||
      !/^[1-9]\d*$/.test(payload.sub) ||
      !['customer', 'staff', 'referrer'].includes(String(payload.mode)) ||
      !Number.isInteger(payload.contextVersion)
    ) {
      return null;
    }
    return payload as MiniProgramJWTPayload;
  } catch (error) {
    if (!(error instanceof JwtSecretUnavailableError)) {
      console.error('[JWT] Verification failed:', error);
    }
    return null;
  }
}
