import { NextResponse } from 'next/server';
import { withTenantTransaction } from '@/db/transaction';
import { DesignReportRepository } from '@/db/repositories/design-report-repository';
import { createReport, listCustomers, reportDto } from '@/lib/design-reports/service';
import { reportRoute, reportBody, reportId, privateHeaders } from '@/lib/design-reports/http';
import { REPORT_PURPOSES, ReportError } from '@/lib/design-reports/contract';

export async function GET(request: Request) {
  return reportRoute(request, async (context) => {
    const params = new URL(request.url).searchParams;
    const data = await withTenantTransaction(context.enterpriseId!, async (tx) => {
      if (params.get('view') === 'customers') return listCustomers(tx, context, params.get('q') || '');
      const rows = await new DesignReportRepository(tx).list(context.role === 'designer' ? BigInt(context.userId) : undefined, params.get('leadId') ? reportId(params.get('leadId')!) : undefined);
      return rows.map(({ report, customer }) => ({ ...reportDto(report), customer }));
    });
    return NextResponse.json({ success: true, data }, { headers: privateHeaders });
  });
}
export async function POST(request: Request) {
  return reportRoute(request, async (context) => {
    const body = await reportBody(request);
    reportId(String(body.leadId));
    if (!Object.hasOwn(REPORT_PURPOSES, body.purpose)) throw new ReportError('请选择汇报目的');
    return NextResponse.json({ success: true, data: await createReport(context, body) }, { headers: privateHeaders });
  });
}
