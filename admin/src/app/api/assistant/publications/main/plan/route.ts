import { NextRequest,NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { AssistantError, key } from '@/lib/assistant/contracts';
import { ConstructionReportService, reportPlanDto } from '@/lib/construction/report-service';

async function handle(request:NextRequest) {
  return withTenantRoute(request,{roles:['enterprise_admin','admin','super_admin'],requireEnterprise:true},async actor=>{
    try {
      if (!actor.enterpriseId || request.nextUrl.searchParams.get('enterprise')!==actor.enterpriseId) throw new AssistantError('settings_enterprise_changed');
      const service=new ConstructionReportService({enterpriseId:actor.enterpriseId,adminId:actor.userId});
      const data=request.method==='GET' ? await service.plan(request.nextUrl.searchParams.get('beforeId') || undefined) :
        reportPlanDto(await service.configure(await request.json(),key(request.headers.get('Idempotency-Key'))),actor.enterpriseId);
      return NextResponse.json({success:true,data},{headers:{'Cache-Control':'private, no-store'}});
    } catch(error) {
      const e=error instanceof AssistantError ? error : new AssistantError(error instanceof SyntaxError?'invalid_message':'construction_report_unavailable',error instanceof SyntaxError?422:503);
      return NextResponse.json({success:false,error:e.code},{status:e.status});
    }
  });
}
export const GET=handle;
export const PUT=handle;
