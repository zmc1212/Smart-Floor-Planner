import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import {
  LeadRepository,
  LeadServiceNeedsRepository,
  LEAD_SERVICE_NEED_LABELS,
  LEAD_SERVICE_NEED_KEYS,
  isLeadServiceNeedKey,
  normalizeLeadServiceNeedKeys,
  type LeadServiceNeedKey,
} from '@/db/repositories';
import type { PostgresTransaction } from '@/db/transaction';
import { getTenantContext } from '@/lib/auth';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import {
  withAdminPostgresTransaction,
  withMiniProgramPostgresTransaction,
} from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

function serializeNeeds(rows: Awaited<ReturnType<LeadServiceNeedsRepository['listForLead']>>) {
  return rows.map((row) => ({
    key: row.needKey,
    label: LEAD_SERVICE_NEED_LABELS[row.needKey as LeadServiceNeedKey] || row.needKey,
    source: row.source,
    updatedAt: row.updatedAt,
  }));
}

async function resolveContext(request: Request) {
  const mini = await resolveMiniProgramContext(request);
  if (mini) return { kind: 'mini' as const, mini };
  const admin = await getTenantContext(request);
  return admin ? { kind: 'admin' as const, admin } : null;
}

function withTransaction<T>(
  context: NonNullable<Awaited<ReturnType<typeof resolveContext>>>,
  callback: (transaction: PostgresTransaction) => Promise<T>,
) {
  return context.kind === 'mini'
    ? withMiniProgramPostgresTransaction(context.mini, callback)
    : withAdminPostgresTransaction(context.admin, callback);
}

function canAccessStaffLead(
  lead: Awaited<ReturnType<LeadRepository['findById']>>,
  context: NonNullable<Awaited<ReturnType<typeof resolveContext>>>,
) {
  if (!lead) return false;
  if (context.kind === 'mini') {
    if (!context.mini.staff) return false;
    if (['admin', 'super_admin', 'enterprise_admin'].includes(context.mini.staff.role)) return true;
    const staffId = parsePostgresId(context.mini.staff._id, 'staff id');
    return lead.assignedTo === staffId || lead.promoterId === staffId || lead.measurerId === staffId;
  }
  if (context.admin.role === 'designer') {
    return lead.assignedTo === parsePostgresId(context.admin.userId, 'userId');
  }
  return true;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveContext(request);
    if (!context) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const leadId = parsePostgresId((await params).id, 'lead id');
    const result = await withTransaction(context, async (transaction) => {
      const lead = await new LeadRepository(transaction).findById(leadId);
      if (!canAccessStaffLead(lead, context) || !lead?.enterpriseId) return null;
      const rows = await new LeadServiceNeedsRepository(transaction).listForLead(lead.enterpriseId, leadId);
      return { rows };
    });
    if (!result) return NextResponse.json({ success: false, error: 'Lead not found or access denied' }, { status: 404 });
    return NextResponse.json({
      success: true,
      data: {
        options: LEAD_SERVICE_NEED_KEYS.map((key) => ({ key, label: LEAD_SERVICE_NEED_LABELS[key] })),
        needs: serializeNeeds(result.rows),
        needKeys: result.rows.map((row) => row.needKey),
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '读取服务需求失败' }, { status: 400 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveContext(request);
    if (!context) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const body = await request.json().catch(() => ({})) as { needKeys?: unknown };
    if (!Array.isArray(body.needKeys) || body.needKeys.some((key) => !isLeadServiceNeedKey(key))) {
      return NextResponse.json({ success: false, code: 'INVALID_SERVICE_NEEDS', error: '服务需求选项无效' }, { status: 400 });
    }
    const leadId = parsePostgresId((await params).id, 'lead id');
    const actorStaffId = context.kind === 'mini' && context.mini.staff
      ? parsePostgresId(context.mini.staff._id, 'staff id')
      : context.kind === 'admin'
        ? parsePostgresId(context.admin.userId, 'userId')
        : null;
    const result = await withTransaction(context, async (transaction) => {
      const lead = await new LeadRepository(transaction).findById(leadId);
      if (!canAccessStaffLead(lead, context) || !lead?.enterpriseId || !actorStaffId) return null;
      const rows = await new LeadServiceNeedsRepository(transaction).replaceForLead({
        enterpriseId: lead.enterpriseId,
        leadId,
        needKeys: normalizeLeadServiceNeedKeys(body.needKeys),
        source: 'designer',
        updatedByStaffId: actorStaffId,
      });
      return { rows };
    });
    if (!result) return NextResponse.json({ success: false, error: 'Lead not found or access denied' }, { status: 404 });
    return NextResponse.json({ success: true, data: { needs: serializeNeeds(result.rows), needKeys: result.rows.map((row) => row.needKey) } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '保存服务需求失败' }, { status: 400 });
  }
}
