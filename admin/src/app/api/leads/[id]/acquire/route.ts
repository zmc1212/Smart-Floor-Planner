import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { leads } from '@/db/schema';
import type { PostgresTransaction } from '@/db/transaction';
import { withTenantTransaction } from '@/db/transaction';
import { acquisitionCommissionToDto, leadToDto, parsePostgresId } from '@/db/postgres-dto';
import { AcquisitionRepository, EnterpriseRepository, LeadRepository } from '@/db/repositories';
import { getTenantContext } from '@/lib/auth';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withAdminPostgresTransaction, withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';
import { notifyMeasurerOfAcquiredLead } from '@/lib/wechat-notification';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const mini = await resolveMiniProgramContext(request);
    const admin = mini ? null : await getTenantContext(request);
    const role = mini?.staff?.role || admin?.role;
    if (role !== 'designer') return NextResponse.json({ success: false, error: '仅设计师可以确认获客' }, { status: 403 });
    const designerId = parsePostgresId(mini?.staff?._id || admin?.userId, 'designer id');
    const leadId = parsePostgresId((await params).id, 'lead id');
    const execute = async (transaction: PostgresTransaction) => {
      const repository = new LeadRepository(transaction);
      const current = await repository.findById(leadId);
      if (!current || current.assignedTo !== designerId) throw new Error('线索不存在或无权操作');
      if (current.status !== 'new') throw new Error('当前线索已确认或已进入后续流程');
      if (!current.enterpriseId || !current.promoterId) throw new Error('线索缺少企业或测量员归属');
      const enterprise = await new EnterpriseRepository(transaction).findById(current.enterpriseId);
      if (!enterprise) throw new Error('企业不存在');
      const updatedRows = await transaction.update(leads).set({ status: 'acquired', acquiredAt: new Date(), acquiredBy: designerId, updatedAt: new Date() })
        .where(and(eq(leads.id, leadId), eq(leads.status, 'new'), eq(leads.assignedTo, designerId))).returning();
      if (!updatedRows[0]) throw new Error('线索状态已被其他操作更新，请刷新后重试');
      const acquisition = new AcquisitionRepository(transaction);
      const commission = await acquisition.createCommission({
        leadId,
        enterpriseId: current.enterpriseId,
        measurerId: current.promoterId,
        designerId,
        commissionAmount: String(enterprise.measurerAcquisitionFixedCommission || '0'),
        status: 'pending_settlement',
        generatedAt: new Date(),
      });
      await acquisition.createNotification({
        enterpriseId: current.enterpriseId,
        recipientStaffId: current.promoterId,
        leadId,
        notificationType: 'lead_acquired_commission_pending',
        channel: 'in_app',
        status: 'unread',
        message: `设计师已确认${current.name}获客，提成待结算`,
        dedupeKey: `lead_acquired_commission_pending:${leadId.toString()}`,
        metadata: { page: `/pages/leads-management/leads-management?leadId=${leadId.toString()}`, commissionId: commission?.id?.toString() || null },
      });
      const lead = await repository.findById(leadId);
      if (!lead || !commission) throw new Error('获客记录保存失败');
      return { lead, commission, measurerId: current.promoterId };
    };
    const result = mini ? await withMiniProgramPostgresTransaction(mini, execute) : await withAdminPostgresTransaction(admin!, execute);
    const delivery = await notifyMeasurerOfAcquiredLead({ ...result.lead, id: result.lead.id, enterpriseId: result.lead.enterpriseId?.toString() }, result.measurerId.toString());
    if (result.lead.enterpriseId) {
      await withTenantTransaction(result.lead.enterpriseId, (transaction) => new AcquisitionRepository(transaction).createNotification({
        enterpriseId: result.lead.enterpriseId,
        recipientStaffId: result.measurerId,
        leadId,
        notificationType: 'lead_acquired_commission_pending',
        channel: 'wechat',
        status: delivery.success ? 'sent' : 'failed',
        message: `Lead ${result.lead.name} acquired; commission pending settlement`,
        errorMessage: delivery.success ? null : delivery.error || null,
        dedupeKey: `lead_acquired_commission_pending:${leadId.toString()}`,
        metadata: { page: `/pages/leads-management/leads-management?leadId=${leadId.toString()}`, commissionId: result.commission.id.toString() },
      }));
    }
    return NextResponse.json({ success: true, data: { lead: leadToDto(result.lead), commission: acquisitionCommissionToDto(result.commission) } });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '确认获客失败' }, { status: 400 });
  }
}
