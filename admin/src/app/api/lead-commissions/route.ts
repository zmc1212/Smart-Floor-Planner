import { NextResponse } from 'next/server';
import { COMMISSION_ROLES, LeadCommissionRepository, type CommissionRole, type LeadCommissionWithRelations } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withTenantTransaction } from '@/db/transaction';
import { httpErrorStatus } from '@/lib/http-error';
import { withTenantRoute } from '@/lib/tenant-route';

function dto(record: LeadCommissionWithRelations) {
  return {
    id: record.id.toString(),
    enterpriseId: record.enterpriseId.toString(),
    lead: record.lead ? {
      id: record.lead.id.toString(), name: record.lead.name, phone: record.lead.phone,
      communityName: record.lead.communityName, status: record.lead.status, contractAmount: record.lead.contractAmount,
    } : null,
    enterprise: record.enterprise ? { id: record.enterprise.id.toString(), name: record.enterprise.name } : null,
    customer: record.customer ? { id: record.customer.id.toString(), nickname: record.customer.nickname, phone: record.customer.phone } : null,
    referrer: record.referrer ? {
      membershipId: record.referrer.membershipId.toString(), userId: record.referrer.userId.toString(),
      nickname: record.referrer.nickname, phone: record.referrer.phone,
    } : null,
    designer: record.designer ? {
      staffId: record.designer.staffId.toString(), userId: record.designer.userId?.toString() ?? null,
      displayName: record.designer.displayName, phone: record.designer.phone,
    } : null,
    measurer: record.measurer ? {
      staffId: record.measurer.staffId.toString(), userId: record.measurer.userId?.toString() ?? null,
      displayName: record.measurer.displayName, phone: record.measurer.phone,
    } : null,
    appointment: record.appointment ? {
      id: record.appointment.id.toString(), address: record.appointment.address,
      timeRange: record.appointment.timeRange, status: record.appointment.status,
    } : null,
    role: record.role,
    beneficiary: record.beneficiary ? {
      id: record.beneficiary.id.toString(), nickname: record.beneficiary.nickname, phone: record.beneficiary.phone,
    } : null,
    ruleType: record.ruleType,
    ruleValue: record.ruleValue,
    ruleVersion: record.ruleVersion,
    contractAmount: record.contractAmount,
    payableAmount: record.payableAmount,
    status: record.status,
    paidAt: record.paidAt,
    paidBy: record.paidBy?.toString() ?? null,
    voidedAt: record.voidedAt,
    voidedBy: record.voidedBy?.toString() ?? null,
    voidReason: record.voidReason,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function GET(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin', 'enterprise_admin'], requireEnterprise: true }, async (context) => {
      const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterprise id');
      const url = new URL(request.url);
      const status = url.searchParams.get('status') || undefined;
      if (status && !['payable', 'paid', 'voided'].includes(status)) {
        return NextResponse.json({ success: false, error: '提成状态无效' }, { status: 400 });
      }
      const leadIdText = url.searchParams.get('leadId');
      const leadId = leadIdText ? parsePostgresId(leadIdText, 'lead id') : undefined;
      const role = url.searchParams.get('role') || undefined;
      if (role && !(COMMISSION_ROLES as readonly string[]).includes(role)) {
        return NextResponse.json({ success: false, error: '提成角色无效' }, { status: 400 });
      }
      const parseDate = (value: string | null, label: string) => {
        if (!value) return undefined;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Object.assign(new Error(`${label}无效`), { status: 400 });
        const date = new Date(`${value}T00:00:00.000Z`);
        if (Number.isNaN(date.getTime())) throw Object.assign(new Error(`${label}无效`), { status: 400 });
        return date;
      };
      const createdFrom = parseDate(url.searchParams.get('fromDate'), '开始日期');
      const toDate = parseDate(url.searchParams.get('toDate'), '结束日期');
      const createdBefore = toDate ? new Date(toDate.getTime() + 86_400_000) : undefined;
      const rows = await withTenantTransaction(enterpriseId, (transaction) =>
        new LeadCommissionRepository(transaction).list(enterpriseId, {
          status, role: role as CommissionRole | undefined, leadId, createdFrom, createdBefore,
        })
      );
      return NextResponse.json({ success: true, data: rows.map(dto) });
    });
  } catch (error) {
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '读取三方提成失败' }, { status: httpErrorStatus(error, 400) });
  }
}
