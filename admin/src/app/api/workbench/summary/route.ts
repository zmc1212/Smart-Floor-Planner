import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { CommissionRecord } from '@/models/CommissionRecord';
import { PromotionEnterpriseRecord } from '@/models/PromotionEnterpriseRecord';
import { getTenantContext } from '@/lib/auth';
import { buildPromotionAccessFilter, getMiniProgramStaffContext } from '@/lib/promotion-workflow';
import { listWorkbenchTodos } from '@/lib/workflow-automation';

export const dynamic = 'force-dynamic';

async function resolveWorkbenchContext(request: Request) {
  const { searchParams } = new URL(request.url);
  const openid = searchParams.get('openid');

  if (openid) {
    const { staff } = await getMiniProgramStaffContext(openid);
    if (!staff) return null;
    return {
      role: staff.role,
      userId: String(staff._id),
      enterpriseId: staff.enterpriseId ? String(staff.enterpriseId) : null,
      openid,
      isMiniProgram: true,
    };
  }

  const context = await getTenantContext(request);
  if (!context) return null;
  return {
    role: context.role,
    userId: context.userId,
    enterpriseId: context.enterpriseId,
    isMiniProgram: false,
  };
}

export async function GET(request: Request) {
  try {
    await dbConnect();
    const context = await resolveWorkbenchContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const recordQuery: Record<string, unknown> =
      context.isMiniProgram
        ? buildPromotionAccessFilter({
            role: context.role,
            _id: context.userId,
            enterpriseId: context.enterpriseId || undefined,
          })
        : {};

    if (!context.isMiniProgram) {
      if (context.enterpriseId) {
        recordQuery.enterpriseId = context.enterpriseId;
      }
      if (context.role === 'salesperson') {
        recordQuery.promoterId = context.userId;
      } else if (context.role === 'measurer') {
        recordQuery['measureTask.assignedTo'] = context.userId;
      } else if (context.role === 'designer') {
        recordQuery['designTask.assignedTo'] = context.userId;
      }
    }

    const [records, commissions, todos, overdueTodos] = await Promise.all([
      PromotionEnterpriseRecord.find(recordQuery).sort({ createdAt: -1 }).lean(),
      context.role === 'salesperson'
        ? CommissionRecord.find({ promoterId: context.userId }).sort({ createdAt: -1 }).lean()
        : context.enterpriseId
          ? CommissionRecord.find({ enterpriseId: context.enterpriseId }).sort({ createdAt: -1 }).lean()
          : Promise.resolve([]),
      listWorkbenchTodos({
        role: context.role,
        userId: context.userId,
        enterpriseId: context.enterpriseId,
        view: 'mine',
      }),
      listWorkbenchTodos({
        role: context.role,
        userId: context.userId,
        enterpriseId: context.enterpriseId,
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

    if (context.role === 'salesperson') {
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
    } else if (context.role === 'measurer') {
      cards = [
        { key: 'mine', label: '我的待办', value: todos.length },
        { key: 'assigned', label: '待接收', value: records.filter((item: any) => item.measureTask?.status === 'assigned').length },
        { key: 'accepted', label: '进行中', value: records.filter((item: any) => item.measureTask?.status === 'accepted').length },
        { key: 'overdueMeasures', label: '已超时测量', value: overdueTodos.length },
      ];
    } else if (context.role === 'designer') {
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
        staffRole: context.role,
        cards,
        latestRecords: records.slice(0, 5),
        latestCommissions: commissions.slice(0, 5),
        latestTodos: todos.slice(0, 5),
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
