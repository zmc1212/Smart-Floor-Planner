import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { CommissionRecord } from '@/models/CommissionRecord';
import { PromotionEnterpriseRecord } from '@/models/PromotionEnterpriseRecord';
import { getTenantContext } from '@/lib/auth';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { buildPromotionAccessFilter } from '@/lib/promotion-workflow';
import { listWorkbenchTodos } from '@/lib/workflow-automation';
import { tenantStorage } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await dbConnect();
    
    // Try Mini Program JWT first
    const mpContext = await resolveMiniProgramContext(request);
    let identity: any = null;

    if (mpContext && mpContext.staff) {
      const { staff } = mpContext;
      identity = {
        role: staff.role,
        userId: String(staff._id),
        enterpriseId: staff.enterpriseId ? String(staff.enterpriseId) : null,
        isMiniProgram: true,
      };
    } else {
      // Fallback to Admin Dashboard session
      const adminContext = await getTenantContext(request);
      if (adminContext) {
        identity = {
          role: adminContext.role,
          userId: adminContext.userId,
          enterpriseId: adminContext.enterpriseId,
          isMiniProgram: false,
        };
      }
    }

    if (!identity) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Use tenantStorage.run to ensure multi-tenant plugin works
    return await tenantStorage.run(
      {
        enterpriseId: identity.enterpriseId,
        role: identity.role,
        userId: identity.userId,
      },
      async () => {
        const recordQuery: Record<string, unknown> = identity.isMiniProgram
          ? buildPromotionAccessFilter({
              role: identity.role,
              _id: identity.userId,
              enterpriseId: identity.enterpriseId || undefined,
            })
          : {};

        const [records, commissions, todos, overdueTodos] = await Promise.all([
          PromotionEnterpriseRecord.find(recordQuery).sort({ createdAt: -1 }).lean(),
          identity.role === 'salesperson'
            ? CommissionRecord.find({ promoterId: identity.userId }).sort({ createdAt: -1 }).lean()
            : identity.enterpriseId
              ? CommissionRecord.find({ enterpriseId: identity.enterpriseId }).sort({ createdAt: -1 }).lean()
              : Promise.resolve([]),
          listWorkbenchTodos({
            role: identity.role,
            userId: identity.userId,
            enterpriseId: identity.enterpriseId,
            view: 'mine',
          }),
          listWorkbenchTodos({
            role: identity.role,
            userId: identity.userId,
            enterpriseId: identity.enterpriseId,
            view: 'overdue',
          }),
        ]);

        const pendingAssignments = records.filter(
          (item: any) =>
            item.ownershipStatus === 'conflict_pending' ||
            (item.businessStage === 'measuring' && item.measureTask?.status === 'unassigned') ||
            (item.measureTask?.status === 'submitted' && item.designTask?.status === 'unassigned')
        ).length;

        let cards: Array<{ key: string; label: string; value: number }> = [];

        if (identity.role === 'salesperson') {
          cards = [
            { key: 'reported', label: '我的报备', value: records.length },
            { key: 'pendingTodo', label: '待跟进', value: todos.length },
            { key: 'overdueFollowUps', label: '已超时跟进', value: overdueTodos.length },
            {
              key: 'pendingCommission',
              label: '待结算提成',
              value: commissions
                .filter((item: any) => item.status === 'pending_settlement')
                .reduce((sum: number, item: any) => sum + Number(item.commissionAmount || 0), 0),
            },
          ];
        } else if (identity.role === 'measurer') {
          cards = [
            { key: 'mine', label: '我的待办', value: todos.length },
            { key: 'assigned', label: '待接收', value: records.filter((item: any) => item.measureTask?.status === 'assigned').length },
            { key: 'accepted', label: '进行中', value: records.filter((item: any) => item.measureTask?.status === 'accepted').length },
            { key: 'overdueMeasures', label: '已超时测量', value: overdueTodos.length },
          ];
        } else if (identity.role === 'designer') {
          cards = [
            { key: 'mine', label: '我的待办', value: todos.length },
            { key: 'assigned', label: '待设计', value: records.filter((item: any) => item.designTask?.status === 'assigned').length },
            { key: 'progress', label: '设计中', value: records.filter((item: any) => item.designTask?.status === 'in_progress').length },
            { key: 'overdueDesigns', label: '已超时设计', value: overdueTodos.length },
          ];
        } else {
          cards = [
            { key: 'records', label: '企业报备', value: records.length },
            { key: 'pendingAssignments', label: '待分配事项', value: pendingAssignments },
            { key: 'overdue', label: '已超时事项', value: overdueTodos.length },
            {
              key: 'pendingCommission',
              label: '待结算提成',
              value: commissions
                .filter((item: any) => item.status === 'pending_settlement')
                .reduce((sum: number, item: any) => sum + Number(item.commissionAmount || 0), 0),
            },
          ];
        }

        return NextResponse.json({
          success: true,
          data: {
            staffRole: identity.role,
            cards,
            latestRecords: records.slice(0, 5),
            latestCommissions: commissions.slice(0, 5),
            latestTodos: todos.slice(0, 5),
          },
        });
      }
    );
  } catch (error: any) {
    console.error('[WorkbenchSummary] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
