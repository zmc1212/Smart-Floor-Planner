import { NextResponse } from 'next/server';
import { reportDetail, mutateReport } from '@/lib/design-reports/service';
import { reportRoute, reportBody, reportId, privateHeaders } from '@/lib/design-reports/http';
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Params) {
  return reportRoute(request, async (context) => NextResponse.json({ success: true, data: await reportDetail(context, reportId((await params).id)) }, { headers: privateHeaders }));
}
export async function PUT(request: Request, { params }: Params) {
  return reportRoute(request, async (context) => NextResponse.json({ success: true, data: await mutateReport(context, reportId((await params).id), 'save', await reportBody(request)) }, { headers: privateHeaders }));
}
