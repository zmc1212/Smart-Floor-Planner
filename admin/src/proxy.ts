import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as jose from 'jose';

const ROUTE_PERMISSIONS: Record<string, string> = {
  '/': 'dashboard',
  '/enterprises': 'enterprises',
  '/enterprise-registration-codes': 'enterprises',
  '/ai-providers': 'ai-providers',
  '/ai-models': 'ai-providers',
  '/ai-presets': 'ai-presets',
  '/media-storage': 'media-storage',
  '/sms-settings': 'sms-settings',
  '/ai-credit-prices': 'ai-credit-prices',
  '/roles': 'roles',
  '/floorplans': 'floorplans',
  '/floorplans/kujiale': 'floorplans',
  '/users': 'users',
  '/devices': 'devices',
  '/measurements': 'measurements',
  '/leads': 'leads',
  '/lead-pool': 'leads',
  '/promotion-records': 'promotion-records',
  '/packages': 'packages',
  '/lead-commissions': 'lead-commissions',
  '/referrer-network-operations': 'referrer-network-operations',
  '/join-codes': 'referrer-network-operations',
  '/referrers': 'referrer-network-operations',
  '/appointment-settings': 'referrer-network-operations',
  '/assignment-settings': 'referrer-network-operations',
  '/staff': 'staff',
  '/admins': 'admins',
  '/api/leads': 'leads',
  '/api/lead-claim-pool': 'leads',
  '/api/floorplans': 'floorplans',
  '/api/kujiale': 'floorplans',
  '/api/staff': 'staff',
  '/api/commission-rules': 'lead-commissions',
  '/api/lead-commissions': 'lead-commissions',
  '/api/enterprise/join-codes': 'referrer-network-operations',
  '/api/enterprise/referrer-memberships': 'referrer-network-operations',
  '/api/enterprise/referrer-network-readiness': 'referrer-network-operations',
  '/api/enterprise/enterprise-reset': 'referrer-network-operations',
  '/api/enterprise/enterprise-purge': 'referrer-network-operations',
  '/api/enterprise/sensitive-password': 'referrer-network-operations',
  '/api/appointment-settings': 'referrer-network-operations',
  '/api/assignment-settings': 'referrer-network-operations',
  '/api/assignment-performance': 'referrer-network-operations',
  '/api/enterprises': 'enterprises',
  '/api/admin/enterprise-registration-codes': 'enterprises',
  '/api/platform/sms-config': 'sms-settings',
  '/api/platform/sms-delivery-logs': 'sms-settings',
  '/ai-studio': 'ai-scenarios',
  '/api/ai/workflows': 'ai-scenarios',
  '/api/ai/workflow-leads': 'ai-scenarios',
  '/api/ai/design-capabilities': 'ai-scenarios',
  '/api/ai/creation': 'ai-scenarios',
  '/api/workbench': 'dashboard',
};

const LEGACY_AI_PERMISSIONS = ['ai-designer', 'ai-floorplan', 'ai-furnishing', 'ai-soft-furnishing'];

function passThrough(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-admin-pathname', request.nextUrl.pathname);
  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Allow unauthenticated entry points and routes with their own verification.
  if (
    pathname === '/login' || 
    pathname === '/api/health' ||
    pathname === '/api/internal/seed' ||
    pathname === '/api/internal/lead-claim-windows/run' ||
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
      } catch {
        // Invalid token, allow access to login
        return passThrough(request);
      }
    }
    return passThrough(request);
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

    if (pathname.startsWith('/media-storage') && role !== 'super_admin' && role !== 'admin') {
      return NextResponse.redirect(new URL('/', request.url));
    }

    // Super admins have all permissions
    if (role === 'super_admin' || role === 'admin') {
      return passThrough(request);
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
        return passThrough(request);
      }

      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }

      // Redirect to home if unauthorized for this specific page
      return NextResponse.redirect(new URL('/', request.url));
    }

    return passThrough(request);
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
     * - brand-logo.png (public product-brand asset)
     */
    '/((?!api/auth/login|_next/static|_next/image|favicon.ico|brand-logo.png).*)',
  ],
};
