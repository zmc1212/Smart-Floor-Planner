import { NextResponse } from 'next/server';
import { customerIdentity } from '@/lib/assistant/application/auth';
import { AssistantError, fail, id } from '@/lib/assistant/contracts';
import { object } from '@/lib/construction/contracts';
import { listOwnerReminders, ownerReminderSummary, updateOwnerReminder } from '@/lib/xiaok-v1/owner-reminder-inbox';

export const runtime = 'nodejs';

async function handle(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const identity = await customerIdentity(request);
    const params = new URL(request.url).searchParams;
    if (request.method === 'GET') {
      if (params.size > 1 || params.size === 1 && !params.has('projectId')) fail('invalid_construction', 422);
      const data = params.has('projectId') ? await listOwnerReminders(identity, id(params.get('projectId')))
        : await ownerReminderSummary(identity);
      return NextResponse.json({ success: true, data }, { headers });
    }
    if (params.size) fail('invalid_construction', 422);
    if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') fail('invalid_construction', 415);
    const raw = await request.text();
    if (raw.length > 2048) fail('invalid_construction', 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { fail('invalid_construction', 422); }
    const { action, projectId, reminderId } = object(body, ['action', 'projectId', 'reminderId']);
    if ((action !== 'prompt' && action !== 'read') || typeof reminderId !== 'string' || !/^rem_[a-f0-9]{24}$/.test(reminderId))
      fail('invalid_construction', 422);
    const data = await updateOwnerReminder(identity, { projectId: id(projectId), reminderId }, action);
    return NextResponse.json({ success: true, data }, { headers });
  } catch (error) {
    if (!(error instanceof AssistantError)) console.error('[owner-reminders] request failed', error);
    const e = error instanceof AssistantError ? error : new AssistantError('stage_reminder_unavailable', 503);
    return NextResponse.json({ success: false, error: e.code, code: e.code }, { status: e.status, headers });
  }
}

export const GET = handle;
export const POST = handle;
