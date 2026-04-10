import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({ success: true });

  // Clear the auth_token cookie
  response.cookies.set({
    name: 'auth_token',
    value: '',
    httpOnly: true,
    expires: new Date(0),
    path: '/',
  });

  return response;
}
