import { NextResponse } from 'next/server';
import { AssistantError, fail } from '@/lib/assistant/contracts';
import { followupMiniActor } from '@/lib/construction/followup-http';
import { stageAnswerForProject } from '@/lib/xiaok-v1/stage-answer-service';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const actor = await followupMiniActor(request);
    if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') fail('invalid_construction', 415);
    const raw = await request.text();
    if (raw.length > 4096) fail('invalid_construction', 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { fail('invalid_construction', 422); }
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !['projectId', 'question'].includes(key))) fail('invalid_construction', 422);
    const data = await stageAnswerForProject(actor, body as { projectId?: unknown; question?: unknown });
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (!(error instanceof AssistantError)) console.error('[stage-answer] unexpected failure', error);
    const e = error instanceof AssistantError ? error : new AssistantError('construction_unavailable', 503);
    return NextResponse.json({ success: false, error: e.code, code: e.code }, { status: e.status, headers: { 'Cache-Control': 'no-store' } });
  }
}
