import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AssistantError, fail } from '@/lib/assistant/contracts';
import { disconnectChannel, pollChannel, readChannel, startChannel } from '@/lib/assistant/wechat/channels';
import { withTenantRoute } from '@/lib/tenant-route';
import { stageIdSchema } from '@/lib/xiaok-v1/stages';

export const runtime = 'nodejs';
const options = { headers: { 'Cache-Control': 'private, no-store' } };
const scopeFields = { stage: z.union([stageIdSchema,z.literal('main')]), enterprise: z.string().regex(/^[1-9]\d*$/) };
const query = z.strictObject(scopeFields);
const mutation = z.discriminatedUnion('action', [
  z.strictObject({ ...scopeFields, action: z.literal('start') }),
  z.strictObject({ ...scopeFields, action: z.literal('poll'), id: z.uuid(), pin: z.string().regex(/^\d{1,12}$/).optional() }),
  z.strictObject({ ...scopeFields, action: z.literal('disconnect'), id: z.uuid() }),
]);
async function handle(request: NextRequest) {
  return withTenantRoute(request, { roles: ['enterprise_admin','admin','super_admin'], requireEnterprise: true }, async actor => {
    try {
      const get = request.method === 'GET';
      const raw = get ? '' : await request.text();
      if (Buffer.byteLength(raw) > 2048) fail('invalid_message', 413);
      const input = get ? { ...query.parse(Object.fromEntries(request.nextUrl.searchParams)), action: 'read' as const } : mutation.parse(JSON.parse(raw));
      if (input.enterprise !== actor.enterpriseId) fail('settings_enterprise_changed');
      const scope = { enterpriseId: actor.enterpriseId, adminId: actor.userId, stage: input.stage };
      const data = input.action === 'read' ? await readChannel(scope) : input.action === 'start' ? await startChannel(scope)
        : input.action === 'poll' ? await pollChannel(scope, input.id, input.pin) : await disconnectChannel(scope, input.id);
      return NextResponse.json({ success: true, data }, options);
    } catch (err) {
      const db = (err as { cause?: { code?: string; constraint?: string } })?.cause;
      const error = err instanceof AssistantError ? err : err instanceof z.ZodError || err instanceof SyntaxError ?
        new AssistantError('invalid_message', 422) : db?.code === '23505' && db.constraint === 'assistant_wechat_active_bot' ?
        new AssistantError('wechat_already_connected', 409) : new AssistantError('wechat_service_unavailable', 503);
      return NextResponse.json({ success: false, error: error.code }, { ...options, status: error.status });
    }
  });
}
export const GET = handle;
export const POST = handle;
