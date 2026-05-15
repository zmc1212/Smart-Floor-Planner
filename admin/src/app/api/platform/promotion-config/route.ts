import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { getPlatformPromotionConfig, savePlatformPromotionConfig } from '@/lib/platform-promotion-config';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const data = await getPlatformPromotionConfig();
      return NextResponse.json({ success: true, data });
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const body = (await request.json()) as {
        protectionPeriodDays?: number;
        protectionExtendDays?: number;
        maxProtectionExtends?: number;
        poolClaimRequiresApproval?: boolean;
      };
      const data = await savePlatformPromotionConfig(body);
      return NextResponse.json({ success: true, data });
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
