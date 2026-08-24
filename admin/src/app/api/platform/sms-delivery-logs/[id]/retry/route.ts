import { NextResponse } from 'next/server';
import { getTenantContext } from '@/lib/auth';
import { retrySmsDeliveryLog } from '@/lib/sms/service';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getTenantContext(request);
    if (!context) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (!['super_admin', 'admin'].includes(context.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    const result = await retrySmsDeliveryLog((await params).id);
    return NextResponse.json({ success: 'success' in result ? result.success : result.status === 'sent', data: result });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '重试短信失败' }, { status: 400 });
  }
}
