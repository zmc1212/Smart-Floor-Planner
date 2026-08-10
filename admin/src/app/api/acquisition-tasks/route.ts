import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AcquisitionRepository, AdminUserRepository } from '@/db/repositories';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';
import { getSignedMiniAiAssetUrl } from '@/lib/ai/mini-ai-assets';
import { getLeadStatusLabel, normalizeLeadStatus } from '@/lib/lead-status';

const CONFIRMABLE_STATUSES = new Set(['new', 'measuring', 'designing', 'converted']);

function parsePage(searchParams: URLSearchParams) {
  return {
    page: Math.max(Number(searchParams.get('page')) || 1, 1),
    limit: Math.min(Math.max(Number(searchParams.get('limit')) || 20, 1), 50),
  };
}

function parseDate(value: string | null, label: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} 不是有效日期`);
  return date;
}

function shanghaiMonthRange(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
  });
  const parts = formatter.formatToParts(now).reduce<Record<string, number>>((result, part) => {
    if (part.type === 'year' || part.type === 'month') result[part.type] = Number(part.value);
    return result;
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

function maskPhone(phone: string) {
  return phone.replace(/^(\d{3})\d{4}(\d+)/, '$1****$2');
}

export async function GET(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context?.staff) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const role = context.staff.role;
    if (role !== 'designer' && role !== 'measurer') {
      return NextResponse.json({ success: false, error: '当前角色没有获客协作任务' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const statusValue = searchParams.get('status') || 'pending_confirmation';
    if (!['pending_confirmation', 'confirmed'].includes(statusValue)) {
      return NextResponse.json({ success: false, error: '无效的获客协作状态' }, { status: 400 });
    }
    const status = statusValue as 'pending_confirmation' | 'confirmed';
    const { page, limit } = parsePage(searchParams);
    const staffId = parsePostgresId(context.staff._id, 'staff id');
    const result = await withMiniProgramPostgresTransaction(context, async (transaction) => {
      const repository = new AcquisitionRepository(transaction);
      const [tasks, summary, designerProfile] = await Promise.all([
        repository.listTasks({
          role,
          staffId,
          status,
          page,
          limit,
          from: parseDate(searchParams.get('from'), 'from'),
          to: parseDate(searchParams.get('to'), 'to'),
        }),
        repository.taskSummary({ role, staffId }, shanghaiMonthRange()),
        role === 'measurer'
          ? new AdminUserRepository(transaction).findDesignerForMeasurer(staffId)
          : Promise.resolve(null),
      ]);
      return { tasks, summary, designerProfile };
    });

    const data = result.tasks.rows.map(({ lead, commission }) => {
      const businessStatus = String(normalizeLeadStatus(lead.status));
      const designer = lead.assignedUser;
      return {
        _id: lead.id.toString(),
        leadId: lead.id.toString(),
        customerName: lead.name,
        phoneMasked: maskPhone(lead.phone),
        communityName: lead.communityName,
        businessStatus,
        businessStatusLabel: getLeadStatusLabel(lead.status),
        acquisitionStatus: lead.acquiredAt ? 'confirmed' : 'pending_confirmation',
        acquiredAt: lead.acquiredAt,
        createdAt: lead.createdAt,
        measurer: lead.promoter
          ? {
              _id: lead.promoter.id.toString(),
              displayName: lead.promoter.displayName,
              username: lead.promoter.username,
            }
          : null,
        designer: designer
          ? {
              _id: designer.id.toString(),
              displayName: designer.displayName,
              username: designer.username,
            }
          : null,
        commission: commission
          ? {
              _id: commission.id.toString(),
              amount: Number(commission.commissionAmount),
              status: commission.status,
              generatedAt: commission.generatedAt,
              settledAt: commission.settledAt,
            }
          : null,
        canConfirm:
          role === 'designer' &&
          !lead.acquiredAt &&
          lead.assignedTo === staffId &&
          CONFIRMABLE_STATUSES.has(businessStatus),
        blockedReason: !lead.acquiredAt && lead.status === 'closed'
          ? '线索已关闭，如需补录请联系管理员'
          : null,
      };
    });

    return NextResponse.json({
      success: true,
      role,
      data,
      summary: result.summary,
      designerProfile: role === 'measurer' && result.designerProfile
        ? {
            _id: result.designerProfile.id.toString(),
            displayName: result.designerProfile.displayName,
            username: result.designerProfile.username,
            wechatId: result.designerProfile.wechatId || null,
            wechatQrUrl:
              result.designerProfile.wechatQrAssetId && result.designerProfile.enterpriseId
                ? getSignedMiniAiAssetUrl({
                    request,
                    assetId: result.designerProfile.wechatQrAssetId.toString(),
                    enterpriseId: result.designerProfile.enterpriseId.toString(),
                  })
                : null,
          }
        : null,
      pagination: {
        total: result.tasks.total,
        page,
        limit,
        totalPages: Math.ceil(result.tasks.total / limit),
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '获客协作任务加载失败' },
      { status: 500 }
    );
  }
}
