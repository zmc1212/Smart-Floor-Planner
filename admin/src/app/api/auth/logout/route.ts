import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

function clearAuthCookie(response: NextResponse) {
  const secureAuthCookie =
    process.env.NODE_ENV === 'production' &&
    process.env.AUTH_COOKIE_SECURE !== 'false';

  response.cookies.set({
    name: 'auth_token',
    value: '',
    httpOnly: true,
    secure: secureAuthCookie,
    sameSite: 'lax',
    expires: new Date(0),
    maxAge: 0,
    path: '/',
  });

  return response;
}

export async function GET() {
  return clearAuthCookie(
    new NextResponse(null, {
      status: 303,
      headers: { Location: '/login' },
    })
  );
}

export async function POST() {
  return clearAuthCookie(NextResponse.json({ success: true }));
}
