import { NextResponse } from 'next/server';
import { getEffectivePermissions } from '@/lib/staff-access';
import { withTenantRoute } from '@/lib/tenant-route';
import {
  assertAllowedImageContentType,
  assertSafeRemoteImageUrl,
  readBoundedImageBody,
} from '@/lib/ai/image-proxy';

export async function GET(req: Request) {
  return withTenantRoute(
    req,
    { roles: ['super_admin', 'admin', 'enterprise_admin', 'designer', 'measurer', 'salesperson', 'viewer'] },
    async (context) => {
      if (!['super_admin', 'admin'].includes(context.role)) {
        const permissions = await getEffectivePermissions(context.role);
        if (!permissions.includes('ai-scenarios')) {
          return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
        }
      }

      try {
        const { searchParams } = new URL(req.url);
        const targetUrl = searchParams.get('url');

        if (!targetUrl) {
          return NextResponse.json({ success: false, error: 'Missing url' }, { status: 400 });
        }

        let parsed = await assertSafeRemoteImageUrl(targetUrl);
        let response = await fetch(parsed, { redirect: 'manual' });
        for (let redirectCount = 0; redirectCount < 3 && response.status >= 300 && response.status < 400; redirectCount += 1) {
          const location = response.headers.get('location');
          if (!location) break;
          parsed = await assertSafeRemoteImageUrl(new URL(location, parsed).toString());
          response = await fetch(parsed, { redirect: 'manual' });
        }
        if (response.status >= 300 && response.status < 400) {
          return NextResponse.json({ success: false, error: 'Image redirects are not allowed' }, { status: 502 });
        }
        if (!response.ok) {
          return NextResponse.json({ success: false, error: 'Failed to fetch image' }, { status: 502 });
        }

        const contentType = assertAllowedImageContentType(response.headers.get('content-type'));
        const buffer = await readBoundedImageBody(response);

        return new NextResponse(buffer, {
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Image proxy failed';
        if (message === 'Unsupported protocol' || message === 'Image URL is too long' || message.includes('Private image host') || message.includes('credentials')) {
          return NextResponse.json({ success: false, error: message }, { status: 400 });
        }
        if (message.includes('too large')) {
          return NextResponse.json({ success: false, error: message }, { status: 413 });
        }
        if (message.includes('allowed image') || message.includes('empty')) {
          return NextResponse.json({ success: false, error: message }, { status: 502 });
        }
        console.error('[AI Image Proxy]', error);
        return NextResponse.json({ success: false, error: 'Image proxy failed' }, { status: 502 });
      }
    }
  );
}
