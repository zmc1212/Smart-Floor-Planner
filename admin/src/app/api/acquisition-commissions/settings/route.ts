import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { EnterpriseRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { withTenantRoute } from '@/lib/tenant-route';

type CommissionSettingsBody = {
  measurerAcquisitionFixedCommission?: unknown;
};

async function getEnterpriseCommissionSetting(enterpriseId: string) {
  return withTenantTransaction(enterpriseId, async (transaction) => {
    const enterprise = await new EnterpriseRepository(transaction).findById(parsePostgresId(enterpriseId));
    if (!enterprise) return null;
    return {
      enterpriseId: enterprise.id.toString(),
      enterpriseName: enterprise.name,
      measurerAcquisitionFixedCommission: Number(enterprise.measurerAcquisitionFixedCommission || 0),
    };
  });
}

export async function GET(request: Request) {
  try {
    return await withTenantRoute(
      request,
      { roles: ['enterprise_admin'], requireEnterprise: true },
      async (context) => {
        const enterpriseId = context.enterpriseId;
        if (!enterpriseId) return NextResponse.json({ success: false, error: '请选择企业' }, { status: 400 });
        const data = await getEnterpriseCommissionSetting(enterpriseId);
        if (!data) return NextResponse.json({ success: false, error: '企业不存在' }, { status: 404 });
        return NextResponse.json({ success: true, data });
      },
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '读取获客提成规则失败' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    return await withTenantRoute(
      request,
      { roles: ['enterprise_admin'], requireEnterprise: true },
      async (context) => {
        const enterpriseId = context.enterpriseId;
        if (!enterpriseId) return NextResponse.json({ success: false, error: '请选择企业' }, { status: 400 });
        const body = (await request.json()) as CommissionSettingsBody;
        const amount = Number(body.measurerAcquisitionFixedCommission);
        if (!Number.isFinite(amount) || amount < 0) {
          return NextResponse.json({ success: false, error: '获客提成金额必须是非负数字' }, { status: 400 });
        }

        const data = await withTenantTransaction(enterpriseId, async (transaction) => {
          const enterprises = new EnterpriseRepository(transaction);
          const parsedEnterpriseId = parsePostgresId(enterpriseId);
          const updated = await enterprises.update(parsedEnterpriseId, {
            measurerAcquisitionFixedCommission: amount.toFixed(2),
          });
          if (!updated) return null;
          return {
            enterpriseId: updated.id.toString(),
            enterpriseName: updated.name,
            measurerAcquisitionFixedCommission: Number(updated.measurerAcquisitionFixedCommission || 0),
          };
        });

        if (!data) return NextResponse.json({ success: false, error: '企业不存在' }, { status: 404 });
        return NextResponse.json({ success: true, data });
      },
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '保存获客提成规则失败' },
      { status: 500 },
    );
  }
}
