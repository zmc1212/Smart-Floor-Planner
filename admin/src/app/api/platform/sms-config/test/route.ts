import { NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { sendSmsTest } from '@/lib/sms/service';

export async function POST(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const body = await request.json().catch(() => ({}));
      const result = await sendSmsTest(typeof body.phone === 'string' ? body.phone : '');
      if (!result.success) {
        return NextResponse.json({ success: false, error: result.errorMessage || '测试短信发送失败', data: result }, { status: 400 });
      }
      return NextResponse.json({ success: true, data: result });
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '测试短信发送失败' },
      { status: 400 }
    );
  }
}
