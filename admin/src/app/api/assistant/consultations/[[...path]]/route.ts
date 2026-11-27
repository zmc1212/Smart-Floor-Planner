import { NextRequest, NextResponse } from 'next/server';
import { ENTERPRISE_MANAGEMENT_ROLES } from '@/lib/admin-user-roles';
import { AssistantError, fail } from '@/lib/assistant/contracts';
import { ConsultationHistory } from '@/lib/assistant/core/consultation-history';
import { withTenantRoute } from '@/lib/tenant-route';

export const runtime = 'nodejs';

export function GET(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return withTenantRoute(request, { roles: [...ENTERPRISE_MANAGEMENT_ROLES], requireEnterprise: true }, async actor => {
    const headers = { 'Cache-Control': 'private, no-store' };
    try {
      const path = (await context.params).path ?? [];
      if (path.length > 1) fail('assistant_resource_not_found', 404);
      const history = new ConsultationHistory(actor.enterpriseId!, actor.userId);
      const params = request.nextUrl.searchParams;
      const data = path.length ? await history.detail(path[0], params.get('beforeSeq')) : await history.list(params);
      return NextResponse.json({ success: true, data }, { headers });
    } catch (error) {
      const failure = error instanceof AssistantError ? error : new AssistantError('assistant_unavailable', 503);
      return NextResponse.json({ success: false, error: failure.code, code: failure.code }, { status: failure.status, headers });
    }
  });
}
