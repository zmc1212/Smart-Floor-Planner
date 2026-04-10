import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const routePermissionMap: Record<string, string> = {
  '/': 'dashboard',
  '/admins': 'admins',
  '/devices': 'devices',
  '/floorplans': 'floorplans',
  '/records': 'records',
  '/users': 'users',
};

export async function proxy(request: NextRequest) {
  const token = request.cookies.get('auth_token')?.value;
  const { pathname } = request.nextUrl;

  // Allow static files and API auth routes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.includes('.') ||
    pathname.startsWith('/api/auth/login')
  ) {
    return NextResponse.next();
  }

  // Handle Login page
  if (pathname === '/login') {
    if (token) {
      try {
        const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback_secret_random_123');
        await jwtVerify(token, secret);
        return NextResponse.redirect(new URL('/', request.url));
      } catch (e) {
        // Invalid token, allow access to login
        return NextResponse.next();
      }
    }
    return NextResponse.next();
  }

  // Protect dashboard routes
  const isProtected = Object.keys(routePermissionMap).some(path => 
    pathname === path || pathname.startsWith(path + '/')
  );

  if (isProtected) {
    if (!token) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    try {
      const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback_secret_random_123');
      const { payload } = await jwtVerify(token, secret);
      
      // Check permissions
      const userPermissions = (payload.permissions as string[]) || [];
      
      // Find the specific permission required for this path
      // We check for exact match or parent path match
      const matchingPath = Object.keys(routePermissionMap)
        .sort((a, b) => b.length - a.length) // Check more specific paths first
        .find(path => pathname === path || pathname.startsWith(path + '/'));

      const requiredPermission = matchingPath ? routePermissionMap[matchingPath] : null;

      if (requiredPermission && !userPermissions.includes(requiredPermission)) {
        // Not authorized for this page, redirect to home or somewhere safe
        return NextResponse.redirect(new URL('/', request.url));
      }

      return NextResponse.next();
    } catch (e) {
      // Invalid token, redirect to login
      const response = NextResponse.redirect(new URL('/login', request.url));
      response.cookies.delete('auth_token');
      return response;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api/auth/login|_next/static|_next/image|favicon.ico).*)'],
};
