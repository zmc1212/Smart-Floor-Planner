import { NextResponse } from 'next/server';
import type { Types } from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { CommissionRecord } from '@/models/CommissionRecord';
import { Enterprise } from '@/models/Enterprise';
import { EnterpriseOrder } from '@/models/EnterpriseOrder';
import { FloorPlan } from '@/models/FloorPlan';
import Lead from '@/models/Lead';
import { PromotionEnterpriseRecord } from '@/models/PromotionEnterpriseRecord';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { buildPromotionAccessFilter } from '@/lib/promotion-workflow';
import { tenantStorage } from '@/lib/tenant-context';
import { listWorkbenchTodos } from '@/lib/workflow-automation';

export const dynamic = 'force-dynamic';

type ActionItem = {
  key: string;
  label: string;
  sublabel: string;
  icon: string;
  target: string;
};

type WorkbenchCard = {
  key: string;
  label: string;
  value: number;
  unit: string;
  detailText: string;
  icon: string;
  tone: 'green' | 'blue' | 'orange' | 'purple';
  target: string;
};

type StaffContext = {
  _id: Types.ObjectId | string;
  role?: string;
  displayName?: string;
  username?: string;
  phone?: string;
  enterpriseId?: Types.ObjectId | string;
};

type CommissionAmount = {
  commissionAmount?: number;
};

const ROLE_LABELS: Record<string, string> = {
  salesperson: '渠道地推',
  enterprise_admin: '企业负责人',
  admin: '平台负责人',
  super_admin: '平台负责人',
  designer: '设计师',
  measurer: '测量员',
};

const ACTIONS_BY_ROLE: Record<string, ActionItem[]> = {
  salesperson: [
    { key: 'create-report', label: '报备企业', sublabel: '拓展合作企业', icon: 'building', target: 'createPromotion' },
    { key: 'pool', label: '可认领客户', sublabel: '认领客户继续跟进', icon: 'users', target: 'promotion:pool' },
    { key: 'commissions', label: '我的提成', sublabel: '查看收益明细', icon: 'wallet', target: 'commissions' },
  ],
  enterprise_admin: [
    { key: 'claimable-customers', label: '线索池管理', sublabel: '查看可认领客户', icon: 'buildingCog', target: 'promotion:pool' },
    { key: 'customers', label: '服务客户', sublabel: '跟进客户线索', icon: 'users', target: 'leads' },
    { key: 'revenue', label: '收益概览', sublabel: '查看成交提成', icon: 'wallet', target: 'commissions' },
  ],
  admin: [
    { key: 'claimable-customers', label: '线索池管理', sublabel: '查看可认领客户', icon: 'buildingCog', target: 'promotion:pool' },
    { key: 'settlement', label: '提成结算', sublabel: '查看收益明细', icon: 'wallet', target: 'commissions' },
  ],
  super_admin: [
    { key: 'claimable-customers', label: '线索池管理', sublabel: '查看可认领客户', icon: 'buildingCog', target: 'promotion:pool' },
    { key: 'settlement', label: '提成结算', sublabel: '查看收益明细', icon: 'wallet', target: 'commissions' },
  ],
  designer: [
    { key: 'customers', label: '客户列表', sublabel: '服务客户线索', icon: 'users', target: 'leads' },
    { key: 'inspiration', label: '灵感库', sublabel: '查看设计灵感', icon: 'wallet', target: 'inspiration' },
  ],
  measurer: [
    { key: 'customers', label: '服务客户', sublabel: '查看客户信息', icon: 'users', target: 'leads' },
    { key: 'measure', label: '去量房', sublabel: '打开量房工具', icon: 'wallet', target: 'measure' },
  ],
};

function maskPhone(phone?: string) {
  if (!phone) return '';
  return phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
}

function startOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function getShanghaiMonthRange(now = new Date()) {
  const values = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now).reduce<Record<string, number>>((result, part) => {
    if (part.type === 'year' || part.type === 'month') result[part.type] = Number(part.value);
    return result;
  }, {});

  const year = values.year || now.getUTCFullYear();
  const month = values.month || now.getUTCMonth() + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const shanghaiOffsetMs = 8 * 60 * 60 * 1000;

  return {
    start: new Date(Date.UTC(year, month - 1, 1) - shanghaiOffsetMs),
    end: new Date(Date.UTC(nextYear, nextMonth - 1, 1) - shanghaiOffsetMs),
  };
}

function formatDueLabel(value?: string) {
  if (!value) return '近期';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '近期';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

  if (target === today) return `今天 ${time}`;
  if (target === today + 24 * 60 * 60 * 1000) return `明天 ${time}`;
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function todoTone(type: string, overdue: boolean): 'green' | 'blue' | 'orange' {
  if (overdue || type.includes('conflict') || type.includes('quote')) return 'orange';
  if (type.includes('design')) return 'blue';
  return 'green';
}

function todoStatusLabel(type: string, overdue: boolean) {
  if (overdue) return '待确认';
  if (type.includes('design')) return '设计中';
  if (type.includes('measure')) return '待量房';
  return '待处理';
}

function card(
  key: string,
  label: string,
  value: number,
  unit: string,
  detailText: string,
  icon: string,
  tone: WorkbenchCard['tone'],
  target: string
): WorkbenchCard {
  return { key, label, value, unit, detailText, icon, tone, target };
}

async function buildWorkbenchCards(role: string, staff: StaffContext): Promise<WorkbenchCard[]> {
  const monthStart = startOfMonth();
  const accessFilter = buildPromotionAccessFilter({
    role,
    _id: staff._id,
    enterpriseId: staff.enterpriseId,
  });

  if (role === 'salesperson') {
    const [reported, todos, monthlyPaid, pendingCommission] = await Promise.all([
      PromotionEnterpriseRecord.countDocuments(accessFilter),
      listWorkbenchTodos({
        role,
        userId: String(staff._id),
        enterpriseId: staff.enterpriseId ? String(staff.enterpriseId) : null,
        view: 'mine',
      }),
      PromotionEnterpriseRecord.countDocuments({ ...accessFilter, businessStage: 'paid', updatedAt: { $gte: monthStart } }),
      CommissionRecord.find({ promoterId: staff._id, status: 'pending_settlement' }).select('commissionAmount').lean(),
    ]);

    const pendingAmount = (pendingCommission as CommissionAmount[]).reduce(
      (sum, item) => sum + Number(item.commissionAmount || 0),
      0
    );
    return [
      card('reported', '我的报备', reported, '个', '持续跟进', 'home', 'green', 'promotion:my'),
      card('pendingTodo', '待跟进', todos.length, '个', todos.length ? `+${todos.length}` : '已清空', 'edit', 'blue', 'promotion:my?filter=todo'),
      card('monthlyPaid', '本月成交', monthlyPaid, '单', monthlyPaid ? `+${monthlyPaid}` : '本月', 'deal', 'green', 'promotion:my?filter=paid'),
      card('pendingCommission', '待结算', pendingAmount, '元', pendingAmount ? '待结算' : '暂无', 'user', 'orange', 'commissions'),
    ];
  }

  if (role === 'designer') {
    const [pendingDesign, designing, monthlyDone, serviceCustomers] = await Promise.all([
      PromotionEnterpriseRecord.countDocuments({ ...accessFilter, 'designTask.status': 'assigned' }),
      PromotionEnterpriseRecord.countDocuments({ ...accessFilter, 'designTask.status': 'in_progress' }),
      PromotionEnterpriseRecord.countDocuments({ ...accessFilter, 'designTask.status': 'completed', 'designTask.completedAt': { $gte: monthStart } }),
      Lead.countDocuments({ assignedTo: staff._id }),
    ]);

    return [
      card('pendingDesign', '待设计', pendingDesign, '个', pendingDesign ? `+${pendingDesign}` : '已清空', 'edit', 'blue', 'promotion:design?filter=designing'),
      card('designing', '设计中', designing, '个', designing ? `+${designing}` : '推进中', 'home', 'green', 'promotion:design?filter=designing'),
      card('monthlyDone', '本月完成', monthlyDone, '单', monthlyDone ? `+${monthlyDone}` : '本月', 'deal', 'green', 'promotion:design'),
      card('customers', '服务客户', serviceCustomers, '位', serviceCustomers ? `+${serviceCustomers}` : '暂无', 'user', 'purple', 'leads'),
    ];
  }

  if (role === 'measurer') {
    const completedPlanFilter = {
      staffId: staff._id,
      status: 'completed',
      'layoutData.version': 4,
      'layoutData.measurementMode': 'surveying',
      'layoutData.surveyGraph.kind': 'survey-wall-graph',
    };
    const monthRange = getShanghaiMonthRange();
    const [pendingMeasure, accepted, monthlyCompleted, totalCompleted] = await Promise.all([
      PromotionEnterpriseRecord.countDocuments({ ...accessFilter, 'measureTask.status': 'assigned' }),
      PromotionEnterpriseRecord.countDocuments({ ...accessFilter, 'measureTask.status': 'accepted' }),
      FloorPlan.countDocuments({ ...completedPlanFilter, completedAt: { $gte: monthRange.start, $lt: monthRange.end } }),
      FloorPlan.countDocuments(completedPlanFilter),
    ]);

    return [
      card('pendingMeasure', '待量房', pendingMeasure, '个', pendingMeasure ? '等待接单' : '暂无待接任务', 'home', 'green', 'promotion:measure?filter=measuring'),
      card('accepted', '进行中', accepted, '个', accepted ? '已接单任务' : '暂无进行中任务', 'edit', 'blue', 'promotion:measure?filter=measuring'),
      card('monthlyCompleted', '本月完成', monthlyCompleted, '单', '按完成时间统计', 'deal', 'green', 'measure'),
      card('totalCompleted', '累计完成', totalCompleted, '单', '正式量房方案', 'user', 'purple', 'measure'),
    ];
  }

  if (role === 'enterprise_admin') {
    const [pendingMeasure, pendingDesign, monthlyPaid, serviceCustomers] = await Promise.all([
      PromotionEnterpriseRecord.countDocuments({
        ...accessFilter,
        businessStage: 'measuring',
        'measureTask.status': { $in: ['unassigned', 'assigned', 'accepted'] },
      }),
      PromotionEnterpriseRecord.countDocuments({
        ...accessFilter,
        $or: [
          { 'designTask.status': { $in: ['unassigned', 'assigned', 'in_progress'] }, businessStage: 'designing' },
          { 'measureTask.status': 'submitted', 'designTask.status': 'unassigned' },
        ],
      }),
      EnterpriseOrder.countDocuments({ enterpriseId: staff.enterpriseId, status: 'paid', paidAt: { $gte: monthStart } }),
      Lead.countDocuments({ enterpriseId: staff.enterpriseId }),
    ]);

    return [
      card('pendingMeasure', '待量房', pendingMeasure, '个', pendingMeasure ? `+${pendingMeasure}` : '已清空', 'home', 'green', 'promotion:measure?filter=measuring'),
      card('pendingDesign', '待设计', pendingDesign, '个', pendingDesign ? `+${pendingDesign}` : '推进中', 'edit', 'blue', 'promotion:design?filter=designing'),
      card('monthlyPaid', '本月成交', monthlyPaid, '单', monthlyPaid ? `+${monthlyPaid}` : '本月', 'deal', 'green', 'promotion:admin?filter=paid'),
      card('customers', '服务客户', serviceCustomers, '位', serviceCustomers ? `+${serviceCustomers}` : '暂无', 'user', 'purple', 'leads'),
    ];
  }

  const [newReports, pendingActions, monthlyPaid, serviceEnterprises] = await Promise.all([
    PromotionEnterpriseRecord.countDocuments({ createdAt: { $gte: monthStart } }),
    PromotionEnterpriseRecord.countDocuments({
      $or: [
        { ownershipStatus: 'conflict_pending' },
        { businessStage: 'measuring', 'measureTask.status': 'unassigned' },
        { 'measureTask.status': 'submitted', 'designTask.status': 'unassigned' },
      ],
    }),
    EnterpriseOrder.countDocuments({ status: 'paid', paidAt: { $gte: monthStart } }),
    Enterprise.countDocuments({ status: 'active' }),
  ]);

  return [
    card('newReports', '新报备', newReports, '个', newReports ? `+${newReports}` : '本月', 'home', 'green', 'promotion:admin'),
    card('pendingActions', '待处理', pendingActions, '个', pendingActions ? `+${pendingActions}` : '已清空', 'edit', 'blue', 'promotion:admin?filter=todo'),
    card('monthlyPaid', '本月成交', monthlyPaid, '单', monthlyPaid ? `+${monthlyPaid}` : '本月', 'deal', 'green', 'promotion:admin?filter=paid'),
    card('enterprises', '服务企业', serviceEnterprises, '家', serviceEnterprises ? `+${serviceEnterprises}` : '暂无', 'user', 'purple', 'promotion:admin'),
  ];
}

export async function GET(request: Request) {
  try {
    await dbConnect();
    const context = await resolveMiniProgramContext(request);

    if (!context) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { user, staff, enterprise } = context;
    if (!staff) {
      return NextResponse.json({
        success: true,
        data: {
          isStaff: false,
          profile: {
            name: user.nickname || user.username || '微信用户',
            avatar: user.avatar || '',
            enterpriseName: user.communityName || '',
            phoneMasked: maskPhone(user.phone),
            roleLabel: '普通用户',
            role: 'user',
          },
          actions: [],
          workbenchCards: [],
          todos: [],
        },
      });
    }

    const role = staff.role || 'viewer';
    const staffId = String(staff._id);
    const enterpriseId = staff.enterpriseId ? String(staff.enterpriseId) : null;

    return await tenantStorage.run(
      {
        enterpriseId,
        role,
        userId: staffId,
      },
      async () => {
        const [workbenchCards, todos] = await Promise.all([
          buildWorkbenchCards(role, staff),
          listWorkbenchTodos({ role, userId: staffId, enterpriseId, view: 'mine' }),
        ]);

        return NextResponse.json({
          success: true,
          data: {
            isStaff: true,
            profile: {
              name: staff.displayName || staff.username || user.nickname || '员工账号',
              avatar: user.avatar || '',
              enterpriseName: enterprise?.name || user.enterpriseName || '智能量房助手',
              phoneMasked: maskPhone(staff.phone || user.phone),
              roleLabel: ROLE_LABELS[role] || '员工账号',
              role,
              staffId,
              enterpriseId,
            },
            actions: ACTIONS_BY_ROLE[role] || ACTIONS_BY_ROLE.enterprise_admin,
            workbenchCards,
            todos: todos.slice(0, 3).map((item) => {
              const tone = todoTone(item.type, item.overdue);
              return {
                recordId: item.recordId,
                title: item.title,
                locationText: item.enterpriseName,
                contactName: item.contactPerson,
                dueLabel: formatDueLabel(item.dueAt),
                statusLabel: todoStatusLabel(item.type, item.overdue),
                statusTone: tone,
                type: item.type,
              };
            }),
          },
        });
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[MiniProgramMine] Error:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
