import * as jose from 'jose';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_random_123';
const secret = new TextEncoder().encode(JWT_SECRET);

export interface MiniProgramJWTPayload extends jose.JWTPayload {
  sub: string;           // Base user ID
  id: string;            // Compatibility alias for the base user ID
  mode: 'customer' | 'staff' | 'referrer';
  role: 'staff' | 'user' | 'super_admin' | 'admin' | 'enterprise_admin' | 'designer' | 'salesperson' | 'measurer' | 'viewer';
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
    .sign(secret);
}

/**
 * Verify a Mini Program token
 */
export async function verifyMiniProgramToken(token: string): Promise<MiniProgramJWTPayload | null> {
  try {
    const { payload } = await jose.jwtVerify(token, secret, {
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
    console.error('[JWT] Verification failed:', error);
    return null;
  }
}
