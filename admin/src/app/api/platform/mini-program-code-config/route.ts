import { NextResponse } from 'next/server';
import {
  getPlatformMiniProgramCodeConfig,
  savePlatformMiniProgramCodeConfig,
} from '@/lib/platform-mini-program-code-config';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () =>
      NextResponse.json({ success: true, data: await getPlatformMiniProgramCodeConfig() })
    );
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
      const body = (await request.json()) as { environment?: unknown };
      const data = await savePlatformMiniProgramCodeConfig(body.environment);
      return NextResponse.json({ success: true, data });
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    );
  }
}
