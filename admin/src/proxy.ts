import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as jose from 'jose';

const ROUTE_PERMISSIONS: Record<string, string> = {
  '/': 'dashboard',
  '/enterprises': 'enterprises',
  '/ai-providers': 'ai-providers',
  '/ai-credit-prices': 'ai-credit-prices',
  '/roles': 'roles',
  '/floorplans': 'floorplans',
  '/floorplans/kujiale': 'floorplans',
  '/users': 'users',
  '/devices': 'devices',
  '/measurements': 'measurements',
  '/leads': 'leads',
  '/promotion-records': 'promotion-records',
  '/packages': 'packages',
  '/staff': 'staff',
  '/admins': 'admins',
  '/api/leads': 'leads',
  '/api/floorplans': 'floorplans',
  '/api/kujiale': 'floorplans',
  '/api/staff': 'staff',
  '/api/enterprises': 'enterprises',
  '/ai-studio': 'ai-scenarios',
  '/api/ai/workflows': 'ai-scenarios',
  '/api/ai/workflow-leads': 'ai-scenarios',
  '/api/ai/design-capabilities': 'ai-scenarios',
};

const LEGACY_AI_PERMISSIONS = ['ai-designer', 'ai-floorplan', 'ai-furnishing', 'ai-soft-furnishing'];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Allow login page, auth APIs, and Mini Program specific APIs
  if (
    pathname === '/login' || 
    pathname.startsWith('/api/auth/') || 
    pathname.startsWith('/api/miniprogram/') ||
    request.headers.get('Authorization')?.startsWith('Bearer ')
  ) {
    const token = request.cookies.get('auth_token')?.value;
    if (pathname === '/login' && token) {
      try {
        const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback_secret_random_123');
        await jose.jwtVerify(token, secret);
        return NextResponse.redirect(new URL('/', request.url));
      } catch (e) {
        // Invalid token, allow access to login
        return NextResponse.next();
      }
    }
    return NextResponse.next();
  }

  // 2. Check for auth token
  const token = request.cookies.get('auth_token')?.value;

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback_secret_random_123');
    const { payload } = await jose.jwtVerify(token, secret);

    const role = payload.role as string;
    const userPermissions = (payload.permissions as string[]) || [];

    // Super admins have all permissions
    if (role === 'super_admin' || role === 'admin') {
      return NextResponse.next();
    }

    // Check permissions for the current route
    const requiredPermission = ROUTE_PERMISSIONS[pathname] ||
      Object.entries(ROUTE_PERMISSIONS)
        .filter(([route]) => route !== '/' && pathname.startsWith(route))
        .sort((a, b) => b[0].length - a[0].length)[0]?.[1] ||
      ROUTE_PERMISSIONS['/'];

    const hasRequiredPermission = !requiredPermission || userPermissions.includes(requiredPermission) || (
      requiredPermission === 'ai-scenarios' && LEGACY_AI_PERMISSIONS.some((permission) => userPermissions.includes(permission))
    );

    if (!hasRequiredPermission) {
      // Prevent redirect loop: if already at root and missing dashboard permission, just proceed 
      // and let the application components handle the empty state/unauthorized view
      if (pathname === '/') {
        return NextResponse.next();
      }

      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }

      // Redirect to home if unauthorized for this specific page
      return NextResponse.redirect(new URL('/', request.url));
    }

    return NextResponse.next();
  } catch (error) {
    console.error('Middleware Auth Error:', error);
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.delete('auth_token');
    return response;
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/auth/login (login endpoint)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api/auth/login|_next/static|_next/image|favicon.ico).*)',
  ],
};
