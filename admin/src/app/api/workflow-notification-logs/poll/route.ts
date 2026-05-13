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

    // Find unread station notifications for the current user
    // We check either by staffId or by role within the enterprise
    const logs = await WorkflowNotificationLog.find({
      enterpriseId: context.enterpriseId,
      channel: 'station',
      recipientStaffId: context.userId,
      isAlerted: false,
      status: 'sent'
    })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

    return NextResponse.json({ success: true, data: logs });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
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
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
