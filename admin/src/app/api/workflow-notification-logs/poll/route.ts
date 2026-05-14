import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { WorkflowNotificationLog } from '@/models/WorkflowNotificationLog';
import { getTenantContext } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await dbConnect();
    const context = await getTenantContext(request);
    
    if (!context || !context.userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const filter: Record<string, unknown> = {
      channel: 'station',
      recipientStaffId: context.userId,
      isAlerted: false,
      status: 'sent'
    };

    if (context.enterpriseId && context.enterpriseId !== 'all') {
      filter.enterpriseId = context.enterpriseId;
    }

    const logs = await WorkflowNotificationLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    return NextResponse.json({ success: true, data: logs });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await dbConnect();
    const context = await getTenantContext(request);
    const { ids } = await request.json();

    if (!context || !context.userId || !ids || !Array.isArray(ids)) {
      return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
    }

    await WorkflowNotificationLog.updateMany(
      { _id: { $in: ids }, recipientStaffId: context.userId },
      { $set: { isAlerted: true } }
    );

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
