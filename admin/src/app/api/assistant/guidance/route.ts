import { NextRequest, NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { AssistantError, fail } from '@/lib/assistant/contracts';
import { GuidanceSettingsService } from '@/lib/assistant/requirements/guidance-settings';
export const runtime = 'nodejs';
async function handle(request: NextRequest) {
  return withTenantRoute(request, { roles: ['super_admin', 'admin', 'enterprise_admin'], requireEnterprise: true }, async actor => {
    try {
      let input;
      if (request.method === 'PUT') {
        const text = await request.text(); if (text.length > 10000) fail('invalid_message', 413);
        try { input = JSON.parse(text); } catch { fail('invalid_message', 422); }
        if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_message', 422);
      }
      const data = await new GuidanceSettingsService(actor.enterpriseId!, actor.userId).execute(input);
      return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
      return NextResponse.json({ success: false, error: e instanceof AssistantError ? e.code : 'assistant_unavailable' },
        { status: e instanceof AssistantError ? e.status : 503, headers: { 'Cache-Control': 'no-store' } });
    }
  });
}
export const GET = handle;
export const PUT = handle;
