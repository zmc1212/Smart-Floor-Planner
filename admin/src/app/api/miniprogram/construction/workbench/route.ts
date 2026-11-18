import { NextRequest, NextResponse } from 'next/server';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { verifyMiniProgramToken } from '@/lib/miniprogram-jwt';
import { AssistantError, fail } from '@/lib/assistant/contracts';
import { constructionWorkbench } from '@/lib/construction/workbench';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  try {
    const actor = await resolveMiniProgramContext(request);
    if (!actor) fail('Unauthorized', 401);
    const token = await verifyMiniProgramToken(request.headers.get('authorization')!.slice(7));
    if (!token) fail('Unauthorized', 401);
    if (actor.mode !== 'staff' || !actor.staff?._id || !actor.enterpriseId) fail('construction_forbidden', 403);
    if (token.source === 'password' && actor.staff.mustChangePassword) fail('construction_password_required', 403);
    const query = [...request.nextUrl.searchParams.entries()];
    if (query.some(([name]) => !['projectId', 'from', 'to'].includes(name))
      || new Set(query.map(([name]) => name)).size !== query.length) fail('invalid_construction', 422);
    const projectId = request.nextUrl.searchParams.get('projectId') || undefined;
    const from = request.nextUrl.searchParams.get('from'), to = request.nextUrl.searchParams.get('to');
    if ((from || to) && (!projectId || !from || !to)) fail('invalid_construction', 422);
    const data = await constructionWorkbench({ enterpriseId: actor.enterpriseId, adminId: actor.staff._id,
      miniProgramUserId: actor.user._id, miniProgramContextVersion: token.contextVersion }, actor.staff.role, projectId,
      from && to ? { from, to } : undefined);
    return NextResponse.json({ success: true, data }, { headers });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof AssistantError ? error.code : 'construction_unavailable' },
      { status: error instanceof AssistantError ? error.status : 503, headers });
  }
}
