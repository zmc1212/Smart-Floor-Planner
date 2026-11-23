import { NextResponse } from 'next/server';
import { customerIdentity } from '@/lib/assistant/application/auth';
import { ownerSiteEnterprise } from '@/lib/construction/owner-home';
import { AssistantError, fail, id, type ActorContext } from '@/lib/assistant/contracts';
import { followupMiniActor } from '@/lib/construction/followup-http';
import { stageAnswerForProject } from '@/lib/xiaok-v1/stage-answer-service';

export const runtime = 'nodejs';

async function stageActor(request: Request, projectId: unknown): Promise<ActorContext> {
  try { return await followupMiniActor(request); }
  catch (error) {
    if (!(error instanceof AssistantError) || error.code !== 'entry_context_invalid' || request.headers.has('X-Assistant-Entry')) throw error;
    const identity = await customerIdentity(request);
    const enterpriseId = await ownerSiteEnterprise(identity.userId, id(projectId));
    return { enterpriseId, principal: { kind: 'user', userId: identity.userId },
      contextVersion: identity.contextVersion, capabilities: ['assistant.followup.self'] };
  }
}

export async function POST(request: Request) {
  try {
    if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') fail('invalid_construction', 415);
    const raw = await request.text();
    if (raw.length > 4096) fail('invalid_construction', 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { fail('invalid_construction', 422); }
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !['projectId', 'question', 'workflowId'].includes(key))) fail('invalid_construction', 422);
    const input = body as Parameters<typeof stageAnswerForProject>[1];
    const data = await stageAnswerForProject(await stageActor(request, input.projectId), input);
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (!(error instanceof AssistantError)) console.error('[stage-answer] unexpected failure', error);
    const e = error instanceof AssistantError ? error : new AssistantError('construction_unavailable', 503);
    return NextResponse.json({ success: false, error: e.code, code: e.code }, { status: e.status, headers: { 'Cache-Control': 'no-store' } });
  }
}
