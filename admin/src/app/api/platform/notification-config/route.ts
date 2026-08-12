import { NextResponse } from 'next/server';
import {
  getPlatformNotificationConfig,
  savePlatformNotificationConfig,
  type PlatformNotificationConfigInput,
} from '@/lib/platform-notification-config';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      return NextResponse.json({ success: true, data: await getPlatformNotificationConfig() });
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const body = (await request.json()) as PlatformNotificationConfigInput;
      const data = await savePlatformNotificationConfig(body);
      return NextResponse.json({ success: true, data });
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    );
  }
}
