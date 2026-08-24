import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import {
  CustomerProjectRepository,
  LeadServiceNeedsRepository,
  LEAD_SERVICE_NEED_LABELS,
  LEAD_SERVICE_NEED_KEYS,
  isLeadServiceNeedKey,
  normalizeLeadServiceNeedKeys,
  type LeadServiceNeedKey,
} from '@/db/repositories';
import { requireMiniProgramPortalMode } from '@/lib/miniprogram-portal-authority';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

function serializeNeeds(rows: Awaited<ReturnType<LeadServiceNeedsRepository['listForLead']>>) {
  return rows.map((row) => ({
    key: row.needKey,
    label: LEAD_SERVICE_NEED_LABELS[row.needKey as LeadServiceNeedKey] || row.needKey,
    source: row.source,
    updatedAt: row.updatedAt,
  }));
}

async function resolveCustomerProject(request: Request, leadIdText: string) {
  const context = await resolveMiniProgramContext(request);
  if (!context) return { error: NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 }) };
  requireMiniProgramPortalMode(context, 'customer');
  const leadId = parsePostgresId(leadIdText, 'lead id');
  const customerUserId = parsePostgresId(context.user._id, 'customer user id');
  return { context, leadId, customerUserId };
}

export async function GET(request: Request, { params }: { params: Promise<{ leadId: string }> }) {
  try {
    const resolved = await resolveCustomerProject(request, (await params).leadId);
    if ('error' in resolved) return resolved.error;
    const rows = await withMiniProgramPostgresTransaction(resolved.context, async (transaction) => {
      const project = await new CustomerProjectRepository(transaction).findCustomerProject(
        resolved.customerUserId,
        resolved.leadId,
      );
      if (!project) return null;
      return new LeadServiceNeedsRepository(transaction).listForLead(project.lead.enterpriseId!, resolved.leadId);
    });
    if (!rows) return NextResponse.json({ success: false, error: '项目不存在或无权访问' }, { status: 404 });
    return NextResponse.json({
      success: true,
      data: {
        options: LEAD_SERVICE_NEED_KEYS.map((key) => ({ key, label: LEAD_SERVICE_NEED_LABELS[key] })),
        needs: serializeNeeds(rows),
        needKeys: rows.map((row) => row.needKey),
      },
    });
  } catch (error) {
    const status = (error as { status?: number }).status || 400;
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '读取服务需求失败' }, { status });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ leadId: string }> }) {
  try {
    const resolved = await resolveCustomerProject(request, (await params).leadId);
    if ('error' in resolved) return resolved.error;
    const body = await request.json().catch(() => ({})) as { needKeys?: unknown };
    if (!Array.isArray(body.needKeys) || body.needKeys.some((key) => !isLeadServiceNeedKey(key))) {
      return NextResponse.json({ success: false, code: 'INVALID_SERVICE_NEEDS', error: '服务需求选项无效' }, { status: 400 });
    }
    const needKeys = normalizeLeadServiceNeedKeys(body.needKeys);
    const rows = await withMiniProgramPostgresTransaction(resolved.context, async (transaction) => {
      const project = await new CustomerProjectRepository(transaction).findCustomerProject(
        resolved.customerUserId,
        resolved.leadId,
      );
      if (!project) return null;
      return new LeadServiceNeedsRepository(transaction).replaceForLead({
        enterpriseId: project.lead.enterpriseId!,
        leadId: resolved.leadId,
        needKeys,
        source: 'customer',
        updatedByUserId: resolved.customerUserId,
      });
    });
    if (!rows) return NextResponse.json({ success: false, error: '项目不存在或无权访问' }, { status: 404 });
    return NextResponse.json({ success: true, data: { needs: serializeNeeds(rows), needKeys: rows.map((row) => row.needKey) } });
  } catch (error) {
    const status = (error as { status?: number }).status || 400;
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '保存服务需求失败' }, { status });
  }
}
