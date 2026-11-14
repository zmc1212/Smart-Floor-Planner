import { NextResponse } from 'next/server';
import { AssistantError, fail } from '@/lib/assistant/contracts';
import { followupMiniActor } from '@/lib/construction/followup-http';
import { cancelStageReminder, listStageReminders, pauseStageReminders, resumeStageReminders } from '@/lib/xiaok-v1/reminder-service';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const actor = await followupMiniActor(request);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => key !== 'projectId') || params.getAll('projectId').length > 1) fail('invalid_construction', 422);
    const data = await listStageReminders(actor, params.get('projectId') || undefined);
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (!(error instanceof AssistantError)) console.error('[reminders] unexpected read failure', error);
    const e = error instanceof AssistantError ? error : new AssistantError('stage_reminder_unavailable', 503);
    return NextResponse.json({ success: false, error: e.code, code: e.code }, { status: e.status, headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await followupMiniActor(request);
    if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') fail('invalid_construction', 415);
    const raw = await request.text();
    if (raw.length > 2048) fail('invalid_construction', 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { fail('invalid_construction', 422); }
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !['projectId', 'action', 'triggerType', 'reminderId'].includes(key))) fail('invalid_construction', 422);
    const value = body as { projectId?: unknown; action?: unknown; triggerType?: unknown; reminderId?: unknown };
    if (!['pause', 'resume', 'cancel'].includes(String(value.action))) fail('invalid_construction', 422);
    const data = String(value.action) === 'cancel'
      ? await cancelStageReminder(actor, value)
      : String(value.action) === 'pause'
        ? await pauseStageReminders(actor, value)
        : await resumeStageReminders(actor, value);
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (!(error instanceof AssistantError)) console.error('[reminders] unexpected write failure', error);
    const e = error instanceof AssistantError ? error : new AssistantError('stage_reminder_unavailable', 503);
    return NextResponse.json({ success: false, error: e.code, code: e.code }, { status: e.status, headers: { 'Cache-Control': 'no-store' } });
  }
}
