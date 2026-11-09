import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { LeadRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { verifyEnterpriseSensitivePassword } from '@/lib/enterprise-sensitive-password';
import { httpError, httpErrorStatus } from '@/lib/http-error';
import {
  buildLeadsExportCsv,
  buildLeadsExportFilename,
} from '@/lib/lead-export-csv';
import { withTenantRoute } from '@/lib/tenant-route';

const EXPORT_MAX_ROWS = 10000;

async function listAllLeadsForExport(enterpriseId: bigint) {
  return withTenantTransaction(enterpriseId, async (transaction) => {
    const repository = new LeadRepository(transaction);
    const total = await repository.count({ archiveState: 'all' });
    if (total > EXPORT_MAX_ROWS) {
      throw httpError(`导出上限为 ${EXPORT_MAX_ROWS} 条线索，请联系平台协助`, 413);
    }
    return repository.listForExport(EXPORT_MAX_ROWS);
  });
}

export async function POST(request: Request) {
  try {
    return await withTenantRoute(
      request,
      { roles: ['enterprise_admin'], requireEnterprise: true },
      async (context) => {
        const enterpriseId = parsePostgresId(context.enterpriseId!, 'enterprise id');
        const body = await request.json();
        const securityPassword = String(body.securityPassword || '').trim();
        if (!securityPassword) {
          return NextResponse.json(
            {
              success: false,
              code: 'sensitive_password_invalid',
              error: '请输入安全密码',
            },
            { status: 400 }
          );
        }

        await withTenantTransaction(enterpriseId, (transaction) =>
          verifyEnterpriseSensitivePassword(transaction, enterpriseId, securityPassword)
        );

        const leads = await listAllLeadsForExport(enterpriseId);
        const csv = buildLeadsExportCsv(leads);
        const filename = buildLeadsExportFilename();

        return new NextResponse(csv, {
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
            'Cache-Control': 'no-store',
          },
        });
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        code: (error as { code?: string }).code,
        error: error instanceof Error ? error.message : '导出失败',
      },
      { status: httpErrorStatus(error, 500) }
    );
  }
}
