import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { WorkflowNotificationLog } from '@/models/WorkflowNotificationLog';
import '@/models/PromotionEnterpriseRecord';
import '@/models/AdminUser';
import '@/models/Enterprise';
import { withTenantRoute } from '@/lib/tenant-route';
import { getPaginationParams, createPaginationMetadata } from '@/lib/pagination';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await dbConnect();
    const { page, limit, skip } = getPaginationParams(request.url);

    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin', 'enterprise_admin'] },
      async (context) => {
        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status');

        if (context.role === 'enterprise_admin' && !context.enterpriseId) {
          return NextResponse.json(
            { success: false, error: 'Please select an enterprise first' },
            { status: 400 }
          );
        }

        // 使用灵活的租户过滤器
        const filter: any = {};
        const matchStage: any = {};

        if (context.enterpriseId && context.enterpriseId !== 'all') {
          filter.enterpriseId = context.enterpriseId;
          if (mongoose.Types.ObjectId.isValid(context.enterpriseId)) {
            matchStage.enterpriseId = new mongoose.Types.ObjectId(context.enterpriseId);
          } else {
            matchStage.enterpriseId = context.enterpriseId;
          }
        }

        if (status && ['sent', 'failed', 'skipped'].includes(status)) {
          filter.status = status;
        }

        const [logs, total, statusCounts] = await Promise.all([
          WorkflowNotificationLog.find(filter)
            .populate({ path: 'recordId', select: 'enterpriseName contactPerson businessStage ownershipStatus' })
            .populate({ path: 'recipientStaffId', select: 'displayName role wecomUserId' })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
          WorkflowNotificationLog.countDocuments(filter),
          WorkflowNotificationLog.aggregate([
            { $match: matchStage },
            { $group: { _id: '$status', count: { $sum: 1 } } }
          ])
        ]);

        const stats = statusCounts.reduce((acc: any, curr: any) => {
          acc[curr._id] = curr.count;
          return acc;
        }, { sent: 0, failed: 0, skipped: 0 });

        return NextResponse.json({ 
          success: true, 
          data: logs,
          pagination: createPaginationMetadata(total, page, limit),
          stats
        });
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
