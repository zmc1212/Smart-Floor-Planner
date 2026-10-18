import { NextRequest, NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { GuidanceSettingsService } from '@/lib/assistant/requirements/guidance-settings';
import { handleHandoff, handoffError } from '@/lib/assistant/handoff/http';
export const runtime='nodejs';
async function handle(request:NextRequest,context:{params:Promise<{path?:string[]}>}) {
  return withTenantRoute(request,{roles:['enterprise_admin'],requireEnterprise:true},async actor=>{
    try {
      await new GuidanceSettingsService(actor.enterpriseId!,actor.userId).execute();
      const data=await handleHandoff(request,(await context.params).path||[],{enterpriseId:actor.enterpriseId!,principal:{kind:'admin',adminId:actor.userId},contextVersion:0,capabilities:['assistant.handoff.staff']});
      if(data instanceof Response)return data;
      return NextResponse.json({success:true,data},{headers:{'Cache-Control':'no-store'}});
    }catch(e){return handoffError(e);}
  });
}
export const GET=handle;
export const POST=handle;
