import { NextResponse } from 'next/server';
import { AppointmentRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withTenantTransaction } from '@/db/transaction';
import { httpErrorStatus } from '@/lib/http-error';
import { withTenantRoute } from '@/lib/tenant-route';

function dto(settings: Awaited<ReturnType<AppointmentRepository['getSettings']>>) {
  return { ...settings, id: settings.id.toString(), enterpriseId: settings.enterpriseId.toString() };
}

export async function GET(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin', 'enterprise_admin'], requireEnterprise: true }, async (context) => {
      const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterprise id');
      const settings = await withTenantTransaction(enterpriseId, (transaction) => new AppointmentRepository(transaction).getSettings(enterpriseId));
      return NextResponse.json({ success: true, data: dto(settings) });
    });
  } catch (error) {
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '读取预约设置失败' }, { status: httpErrorStatus(error, 400) });
  }
}

export async function PUT(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin', 'enterprise_admin'], requireEnterprise: true }, async (context) => {
      const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterprise id');
      const body = await request.json();
      const settings = await withTenantTransaction(enterpriseId, (transaction) => new AppointmentRepository(transaction).updateSettings(enterpriseId, body));
      return NextResponse.json({ success: true, data: dto(settings) });
    });
  } catch (error) {
    return NextResponse.json({ success: false, code: (error as { code?: string }).code, error: error instanceof Error ? error.message : '更新预约设置失败' }, { status: httpErrorStatus(error, 400) });
  }
}
