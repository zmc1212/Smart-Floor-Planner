import { NextResponse } from 'next/server';
import { getSmsConfig, saveSmsConfig, type SmsConfigInput } from '@/lib/sms-config';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
    return NextResponse.json({ success: true, data: await getSmsConfig() });
  });
}

export async function PATCH(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const body = (await request.json()) as SmsConfigInput;
      return NextResponse.json({ success: true, data: await saveSmsConfig(body) });
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '保存短信配置失败' },
      { status: 400 }
    );
  }
}
