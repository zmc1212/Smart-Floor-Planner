import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { getTenantContext } from '@/lib/auth';
import { loadOpsDashboard, resolveWorkbenchPeriod } from '@/lib/miniprogram-workbench';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

type OpsRole = 'enterprise_admin' | 'designer' | 'measurer';

function parsePeriod(request: Request) {
  const url = new URL(request.url);
  return resolveWorkbenchPeriod({
    period: url.searchParams.get('period'),
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
  });
}

export async function GET(request: Request) {
  try {
    const context = await getTenantContext(request);
    if (!context?.enterpriseId) {
      return NextResponse.json({ success: false, error: '需要企业登录身份' }, { status: 401 });
    }

    const role = context.role as OpsRole | string;
    if (!['enterprise_admin', 'designer', 'measurer'].includes(role)) {
      return NextResponse.json({ success: false, error: '当前身份没有经营大盘权限' }, { status: 403 });
    }

    let period;
    try {
      period = parsePeriod(request);
    } catch (error) {
      return NextResponse.json({
        success: false,
        error: error instanceof Error ? error.message : '周期参数无效',
      }, { status: 400 });
    }

    const data = await withAdminPostgresTransaction(context, async (transaction) => {
      const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterprise id');
      const staffId = parsePostgresId(context.userId, 'user id');

      if (role === 'enterprise_admin') {
        return loadOpsDashboard(transaction, {
          enterpriseId,
          period,
          includeContractAmount: true,
        });
      }

      return loadOpsDashboard(transaction, {
        enterpriseId,
        period,
        scope: {
          staffId,
          staffVisibility: role === 'measurer' ? 'measurer' : 'assigned',
        },
        includeContractAmount: false,
      });
    });

    return NextResponse.json({
      success: true,
      data: {
        role,
        ...data,
      },
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '读取经营大盘失败',
    }, { status: 500 });
  }
}
