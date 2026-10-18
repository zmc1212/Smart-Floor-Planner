import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { AssistantError, fail } from '@/lib/assistant/contracts';
import { OperationsService } from '@/lib/assistant/operations';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return withTenantRoute(request, { roles: ['enterprise_admin'], requireEnterprise: true }, async context => {
    const requestId = randomUUID();
    try {
      const params = request.nextUrl.searchParams;
      if ([...params.keys()].some(key => !['from', 'to'].includes(key))) fail('invalid_message', 422);
      const data = await new OperationsService({
        enterpriseId: context.enterpriseId!,
        principal: { kind: 'admin', adminId: context.userId },
        contextVersion: 1,
        capabilities: ['assistant.usage.read'],
      }).snapshot(params.get('from'), params.get('to'));
      return NextResponse.json({ success: true, data, requestId }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      const safe = error instanceof AssistantError ? error : new AssistantError('assistant_unavailable', 503);
      return NextResponse.json({ success: false, error: safe.code, code: safe.code, requestId }, { status: safe.status, headers: { 'Cache-Control': 'no-store' } });
    }
  });
}
