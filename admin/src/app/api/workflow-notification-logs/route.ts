import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { WorkflowNotificationLog } from '@/models/WorkflowNotificationLog';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await dbConnect();

    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin', 'enterprise_admin'] },
      async (context) => {
        const { searchParams } = new URL(request.url);
        const limit = Math.min(Number(searchParams.get('limit') || 50), 200);
        const status = searchParams.get('status');

        if (context.role === 'enterprise_admin' && !context.enterpriseId) {
          return NextResponse.json(
            { success: false, error: 'Please select an enterprise first' },
            { status: 400 }
          );
        }

        const filter: Record<string, unknown> = {};
        if (context.enterpriseId) {
          filter.enterpriseId = context.enterpriseId;
        }
        if (status && ['sent', 'failed', 'skipped'].includes(status)) {
          filter.status = status;
        }

        const logs = await WorkflowNotificationLog.find(filter)
          .populate({ path: 'recordId', select: 'enterpriseName contactPerson businessStage ownershipStatus' })
          .populate({ path: 'recipientStaffId', select: 'displayName role wecomUserId' })
          .sort({ createdAt: -1 })
          .limit(limit)
          .lean();

        return NextResponse.json({ success: true, data: logs });
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
