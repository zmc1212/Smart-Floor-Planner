import { NextResponse } from 'next/server';
import {
  COMMISSION_ROLES,
  LeadCommissionRepository,
  type CommissionRuleInput,
} from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withTenantTransaction } from '@/db/transaction';
import { httpErrorStatus } from '@/lib/http-error';
import { withTenantRoute } from '@/lib/tenant-route';

function ruleDto(rule: Awaited<ReturnType<LeadCommissionRepository['listRules']>>[number]) {
  return {
    id: rule.id.toString(),
    enterpriseId: rule.enterpriseId.toString(),
    role: rule.role,
    calculationType: rule.calculationType,
    value: rule.value,
    status: rule.status,
    version: rule.version,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

function parseRules(body: unknown): CommissionRuleInput[] {
  const values = (body as { rules?: unknown })?.rules;
  if (!Array.isArray(values)) throw Object.assign(new Error('rules 必须是数组'), { status: 400 });
  return values.map((value) => {
    const item = value as Record<string, unknown>;
    return {
      role: String(item.role || '') as CommissionRuleInput['role'],
      calculationType: String(item.calculationType || '') as CommissionRuleInput['calculationType'],
      value: String(item.value ?? ''),
      status: String(item.status || '') as CommissionRuleInput['status'],
      version: Number(item.version),
    };
  });
}

export async function GET(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin', 'enterprise_admin'], requireEnterprise: true }, async (context) => {
      const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterprise id');
      const actorId = parsePostgresId(context.userId, 'actor id');
      const rules = await withTenantTransaction(enterpriseId, (transaction) =>
        new LeadCommissionRepository(transaction).listRules(enterpriseId, actorId)
      );
      return NextResponse.json({ success: true, data: rules.map(ruleDto) });
    });
  } catch (error) {
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '读取提成规则失败' }, { status: httpErrorStatus(error, 400) });
  }
}

export async function PUT(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin', 'enterprise_admin'], requireEnterprise: true }, async (context) => {
      const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterprise id');
      const actorId = parsePostgresId(context.userId, 'actor id');
      const inputs = parseRules(await request.json());
      const rules = await withTenantTransaction(enterpriseId, (transaction) =>
        new LeadCommissionRepository(transaction).updateRules(enterpriseId, actorId, inputs)
      );
      return NextResponse.json({ success: true, data: rules.map(ruleDto), roles: COMMISSION_ROLES });
    });
  } catch (error) {
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '更新提成规则失败' }, { status: httpErrorStatus(error, 400) });
  }
}
