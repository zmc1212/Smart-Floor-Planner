import * as jose from 'jose';
import { NextResponse } from 'next/server';
import type { AdminUserRecord } from '@/db/repositories';

const SESSION_SECONDS = 60 * 60 * 24;

export async function signAdminSession(input: {
  admin: AdminUserRecord;
  permissions: string[];
}) {
  const { admin, permissions } = input;
  const secret = new TextEncoder().encode(
    process.env.JWT_SECRET || 'fallback_secret_random_123'
  );
  return new jose.SignJWT({
    id: admin.id.toString(),
    username: admin.username,
    displayName: admin.displayName,
    role: admin.role,
    enterpriseId: admin.enterpriseId?.toString() || null,
    permissions,
    mustChangePassword: admin.mustChangePassword,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(secret);
}

export function setAdminSessionCookie(response: NextResponse, token: string) {
  const secure =
    process.env.NODE_ENV === 'production' &&
    process.env.AUTH_COOKIE_SECURE !== 'false';
  response.cookies.set({
    name: 'auth_token',
    value: token,
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: SESSION_SECONDS,
    path: '/',
  });
  return response;
}
