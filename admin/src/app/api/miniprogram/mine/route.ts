import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import {
  EnterpriseRepository,
  AcquisitionRepository,
  FloorPlanRepository,
  LeadRepository,
  MeasurementRepository,
} from '@/db/repositories';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

type ActionItem = {
  key: string;
  label: string;
  sublabel: string;
  icon: string;
  target: string;
  badgeCount?: number;
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
    { key: 'acquisition', label: '获客协作', sublabel: '确认客户微信交接', icon: 'clipboard-pen', target: 'acquisition' },
    { key: 'customers', label: '客户列表', sublabel: '服务客户线索', icon: 'users', target: 'leads' },
    { key: 'inspiration', label: '灵感库', sublabel: '查看设计灵感', icon: 'wallet', target: 'inspiration' },
  ],
  measurer: [
    { key: 'acquisition', label: '获客协作', sublabel: '跟进微信交接', icon: 'clipboard-pen', target: 'acquisition' },
    { key: 'commissions', label: '我的提成', sublabel: '查看获客奖励', icon: 'wallet', target: 'commissions' },
    { key: 'customers', label: '服务客户', sublabel: '查看客户信息', icon: 'users', target: 'leads' },
    { key: 'measure', label: '去量房', sublabel: '打开量房工具', icon: 'wallet', target: 'measure' },
  ],
};

function maskPhone(phone?: string) {
  if (!phone) return '';
  return phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
}

function shanghaiMonthRange(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
  })
    .formatToParts(now)
    .reduce<Record<string, number>>((values, part) => {
      if (part.type === 'year' || part.type === 'month') {
        values[part.type] = Number(part.value);
      }
      return values;
    }, {});
  const year = parts.year || now.getUTCFullYear();
  const month = parts.month || now.getUTCMonth() + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const offset = 8 * 60 * 60 * 1000;
  return {
    start: new Date(Date.UTC(year, month - 1, 1) - offset),
    end: new Date(Date.UTC(nextYear, nextMonth - 1, 1) - offset),
  };
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

export async function GET(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
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
    const staffId = parsePostgresId(staff._id, 'staff id');
    const month = shanghaiMonthRange();
    const workbenchCards = await withMiniProgramPostgresTransaction(
      context,
      async (transaction) => {
        const leads = new LeadRepository(transaction);
        const floorPlans = new FloorPlanRepository(transaction);
        const measurements = new MeasurementRepository(transaction);
        const staffLeadOptions =
          role === 'enterprise_admin'
            ? {}
            : {
                staffId,
                staffVisibility: 'promoted-or-assigned' as const,
              };
        const staffPlanOptions =
          role === 'enterprise_admin' ? {} : { staffId };
        const [customerCount, activePlans, monthlyCompleted, auditCount] =
          await Promise.all([
            leads.count(staffLeadOptions),
            floorPlans.count({
              ...staffPlanOptions,
              formalOnly: true,
              status: 'draft',
            }),
            floorPlans.count({
              ...staffPlanOptions,
              formalOnly: true,
              status: 'completed',
              completedFrom: month.start,
              completedBefore: month.end,
            }),
            measurements.count(
              role === 'enterprise_admin' ? {} : { operatorId: staffId }
            ),
          ]);

        if (role === 'admin' || role === 'super_admin') {
          const enterpriseCount = (
            await new EnterpriseRepository(transaction).list()
          ).length;
          return [
            card('enterprises', '服务企业', enterpriseCount, '家', 'PostgreSQL 实时数据', 'home', 'green', 'promotion:admin'),
            card('customers', '客户线索', customerCount, '位', '当前可见范围', 'user', 'purple', 'leads'),
            card('activePlans', '量房草稿', activePlans, '单', '正式墙图草稿', 'edit', 'blue', 'measure'),
            card('audits', '测量审计', auditCount, '次', '正式测量记录', 'deal', 'orange', 'measure'),
          ];
        }
        return [
          card('customers', '服务客户', customerCount, '位', customerCount ? `+${customerCount}` : '暂无', 'user', 'purple', 'leads'),
          card('activePlans', '进行中', activePlans, '单', activePlans ? '继续量房' : '暂无草稿', 'edit', 'blue', 'measure'),
          card('monthlyCompleted', '本月完成', monthlyCompleted, '单', '按完成时间统计', 'deal', 'green', 'measure'),
          card('audits', '测量记录', auditCount, '次', '正式测量审计', 'home', 'orange', 'measure'),
        ];
      }
    );
    const acquisitionMeta = await withMiniProgramPostgresTransaction(
      context,
      async (transaction) => {
        const repository = new AcquisitionRepository(transaction);
        const unreadNotificationCount = (await repository.listNotifications(staffId, true)).length;
        const acquisitionSummary = role === 'designer' || role === 'measurer'
          ? await repository.taskSummary({ role, staffId }, month)
          : null;
        return { unreadNotificationCount, acquisitionSummary };
      }
    );

    const actions = (ACTIONS_BY_ROLE[role] || ACTIONS_BY_ROLE.enterprise_admin).map((action) => (
      action.target === 'acquisition'
        ? { ...action, badgeCount: acquisitionMeta.acquisitionSummary?.pendingCount || 0 }
        : action
    ));

    return NextResponse.json({
      success: true,
      data: {
        isStaff: true,
        profile: {
          name: staff.displayName || staff.username || user.nickname || '员工账号',
          avatar: user.avatar || '',
          enterpriseName: enterprise?.name || '智能量房助手',
          phoneMasked: maskPhone(staff.phone || user.phone),
          roleLabel: ROLE_LABELS[role] || '员工账号',
          role,
          staffId: staff._id,
          enterpriseId: staff.enterpriseId || context.enterpriseId || null,
        },
        actions,
        workbenchCards,
        unreadNotificationCount: acquisitionMeta.unreadNotificationCount,
        // Commercial workflow todos remain empty until that PostgreSQL domain switches.
        todos: [],
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[MiniProgramMine] Error:', error);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
