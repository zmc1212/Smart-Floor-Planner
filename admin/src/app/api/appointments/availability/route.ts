import { NextResponse } from 'next/server';
import { AppointmentRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { httpErrorStatus } from '@/lib/http-error';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { getTenantContext } from '@/lib/auth';
import { withAdminPostgresTransaction, withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const leadIdText = new URL(request.url).searchParams.get('leadId') || '';
    if (!/^[1-9]\d*$/.test(leadIdText)) return NextResponse.json({ success: false, error: '线索无效' }, { status: 400 });
    const date = new URL(request.url).searchParams.get('date') || '';
    const context = await resolveMiniProgramContext(request);
    const admin = context ? null : await getTenantContext(request);
    if (!context && !admin) return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
    if (admin && (!admin.enterpriseId || !['designer', 'enterprise_admin'].includes(admin.role))) {
      return NextResponse.json({ success: false, error: '仅负责家装设计顾问或企业负责人可查看可用时段' }, { status: 403 });
    }
    if (admin) {
      const data = await withAdminPostgresTransaction(admin, async (transaction) => {
        const repository = new AppointmentRepository(transaction);
        const enterpriseId = parsePostgresId(admin.enterpriseId!, 'enterprise id');
        const lead = await repository.findLeadForAccess(enterpriseId, BigInt(leadIdText));
        if (!lead || (admin.role === 'designer' && lead.assignedTo !== parsePostgresId(admin.userId, 'user id'))) return null;
        return repository.listAvailability({ enterpriseId, leadId: BigInt(leadIdText), date });
      });
      if (!data) return NextResponse.json({ success: false, error: '无权查看该线索预约' }, { status: 403 });
      return NextResponse.json({
        success: true,
        data: {
          timezone: data.settings.timezone,
          durationMinutes: data.settings.defaultDurationMinutes,
          slotStepMinutes: data.settings.slotStepMinutes,
          maxAdvanceDays: data.settings.maxAdvanceDays,
          slots: data.available.map((slot) => ({ startAt: slot.startAt, endAt: slot.endAt, measurerId: slot.measurerId.toString() })),
        },
      });
    }
    if (!context) return NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 });
    const data = await withMiniProgramPostgresTransaction(context, async (transaction) => {
      const repository = new AppointmentRepository(transaction);
      const lead = context.mode === 'customer'
        ? await repository.findCustomerLeadForAccess(BigInt(context.user._id), BigInt(leadIdText))
        : context.enterpriseId
          ? await repository.findLeadForAccess(parsePostgresId(context.enterpriseId, 'enterprise id'), BigInt(leadIdText))
          : null;
      if (!lead?.enterpriseId) return null;
      if (context.mode === 'staff' && context.staff?.role === 'designer' && lead.assignedTo !== BigInt(context.staff._id)) return null;
      if (context.mode === 'staff' && context.staff?.role === 'measurer' && lead.measurerId !== BigInt(context.staff._id)) return null;
      return repository.listAvailability({ enterpriseId: lead.enterpriseId, leadId: BigInt(leadIdText), date });
    });
    if (!data) return NextResponse.json({ success: false, error: '无权查看该线索预约' }, { status: 403 });
    return NextResponse.json({
      success: true,
      data: {
        timezone: data.settings.timezone,
        durationMinutes: data.settings.defaultDurationMinutes,
        slotStepMinutes: data.settings.slotStepMinutes,
        maxAdvanceDays: data.settings.maxAdvanceDays,
        slots: data.available.map((slot) => ({ startAt: slot.startAt, endAt: slot.endAt, measurerId: slot.measurerId.toString() })),
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '读取可用时段失败' }, { status: httpErrorStatus(error, 400) });
  }
}
