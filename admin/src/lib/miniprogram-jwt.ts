import * as jose from 'jose';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_random_123';
const secret = new TextEncoder().encode(JWT_SECRET);

export interface MiniProgramJWTPayload extends jose.JWTPayload {
  id: string;            // AdminUser._id or User._id
  role: 'staff' | 'user' | 'super_admin' | 'admin' | 'enterprise_admin' | 'designer' | 'salesperson' | 'measurer' | 'viewer';
  staffRole?: string;    // Specific role if staff
  enterpriseId?: string; // Enterprise context
  openid?: string;       // Original openid if available
  source: 'wechat' | 'password' | 'phone';
}

/**
 * Sign a token for the Mini Program
 * Default expiration: 21 days
 */
export async function signMiniProgramToken(payload: MiniProgramJWTPayload): Promise<string> {
  return await new jose.SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
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
    return payload as MiniProgramJWTPayload;
  } catch (error) {
    console.error('[JWT] Verification failed:', error);
    return null;
  }
}

/**
 * Silent refresh: Issue a new token if the old one is valid but nearing expiry
 * Or simply re-issue upon valid check to slide the window
 */
export async function refreshMiniProgramToken(token: string): Promise<string | null> {
  const payload = await verifyMiniProgramToken(token);
  if (!payload) return null;

  // Re-issue with new timestamps
  const { iat, exp, aud, ...rest } = payload;
  return await signMiniProgramToken(rest as MiniProgramJWTPayload);
}
