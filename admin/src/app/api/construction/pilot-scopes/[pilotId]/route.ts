import { NextRequest, NextResponse } from 'next/server';
import { AssistantError, fail } from '@/lib/assistant/contracts';
import { withTenantRoute } from '@/lib/tenant-route';
import { PilotProjectScopeService } from '@/lib/xiaok-v1/pilot-project-scope';

export const runtime = 'nodejs';
type Context = { params: Promise<{ pilotId: string }> };
const headers = { 'Cache-Control': 'no-store' };

async function handle(request: NextRequest, { params }: Context) {
  return withTenantRoute(request, { roles: ['enterprise_admin', 'admin', 'super_admin'], requireEnterprise: true }, async actor => {
    try {
      const { pilotId } = await params;
      const service = new PilotProjectScopeService({ enterpriseId: actor.enterpriseId!, adminId: actor.userId });
      let data;
      if (request.method === 'PUT') {
        const body = await request.text();
        if (body.length > 32000) fail('pilot_scope_invalid', 413);
        let input: unknown;
        try { input = JSON.parse(body); } catch { fail('pilot_scope_invalid', 422); }
        data = await service.save(pilotId, input);
      } else {
        data = await service.read(pilotId);
      }
      return NextResponse.json({ success: true, data }, { headers });
    } catch (error) {
      return NextResponse.json({ success: false, error: error instanceof AssistantError ? error.code : 'pilot_scope_unavailable' },
        { headers, status: error instanceof AssistantError ? error.status : 503 });
    }
  });
}

export const GET = handle;
export const PUT = handle;
