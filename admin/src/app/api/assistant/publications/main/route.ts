import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AssistantError } from '@/lib/assistant/contracts';
import { withTenantRoute } from '@/lib/tenant-route';
import { manageMainPublication, publicationInput } from '@/lib/xiaok-v1/main-publication';

async function handle(request: NextRequest) {
  return withTenantRoute(request, { roles: ['enterprise_admin','admin','super_admin'], requireEnterprise: true }, async actor => {
    try {
      if (!actor.enterpriseId || request.nextUrl.searchParams.get('enterprise') !== actor.enterpriseId) throw new AssistantError('settings_enterprise_changed',409);
      const input = request.method === 'PUT' ? publicationInput.parse(await request.json()) : undefined;
      const data = await manageMainPublication(actor.enterpriseId, actor.userId, input);
      return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) {
      const e = error instanceof AssistantError ? error : new AssistantError(
        error instanceof z.ZodError || error instanceof SyntaxError ? 'invalid_message' : 'assistant_unavailable',
        error instanceof z.ZodError || error instanceof SyntaxError ? 422 : 503);
      return NextResponse.json({ success: false, error: e.code }, { status: e.status });
    }
  });
}
export const GET = handle;
export const PUT = handle;
