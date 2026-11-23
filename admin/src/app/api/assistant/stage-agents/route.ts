import { NextRequest, NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { AssistantError, fail } from '@/lib/assistant/contracts';
import { WorkflowOperationError } from '@/lib/native-workflow/errors';
import { listStageAgentSettings, saveStageAgent } from '@/lib/xiaok-v1/stage-workflow-settings';

export const runtime = 'nodejs';

async function handle(request: NextRequest) {
  return withTenantRoute(request, { roles: ['admin', 'super_admin', 'enterprise_admin'], requireEnterprise: true }, async actor => {
    const headers = { 'Cache-Control': 'no-store' };
    try {
      if (request.method === 'GET') {
        const data = await listStageAgentSettings(actor.enterpriseId!, actor.userId);
        return NextResponse.json({ success: true, data }, { headers });
      }
      const text = await request.text();
      if (text.length > 8000) fail('invalid_message', 413);
      let input: unknown;
      try { input = JSON.parse(text); } catch { fail('invalid_message', 422); }
      const create = request.method === 'POST';
      const data = await saveStageAgent(actor.enterpriseId!, actor.userId, input, create);
      return NextResponse.json({ success: true, data }, { status: create ? 201 : 200, headers });
    } catch (error) {
      if (error instanceof WorkflowOperationError) {
        return NextResponse.json({ success: false, error: 'stage_workflow_unavailable' }, { status: error.status, headers });
      }
      const known = error instanceof AssistantError;
      return NextResponse.json({ success: false, error: known ? error.code : 'assistant_unavailable' },
        { status: known ? error.status : 503, headers });
    }
  });
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
