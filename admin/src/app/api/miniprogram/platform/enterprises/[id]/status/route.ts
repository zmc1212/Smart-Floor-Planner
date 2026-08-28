import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import {
  applyEnterpriseStatusChange,
  enterpriseStatusChangeErrorResponse,
} from '@/lib/enterprise-status-change';
import {
  parsePlatformAdminActorId,
  platformAdminForbiddenResponse,
  resolveMiniProgramPlatformAdmin,
  toPlatformEnterpriseReviewDto,
} from '@/lib/miniprogram-platform-enterprises';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await resolveMiniProgramPlatformAdmin(request);
    if (!context) return platformAdminForbiddenResponse();

    const { id } = await params;
    const body = (await request.json()) as {
      action?: unknown;
      reason?: unknown;
    };

    const result = await applyEnterpriseStatusChange({
      enterpriseId: parsePostgresId(id),
      action: body.action,
      reason: body.reason,
      actorAdminId: parsePlatformAdminActorId(context),
    });

    if (!result) {
      return NextResponse.json(
        { success: false, error: 'Enterprise not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: toPlatformEnterpriseReviewDto(
        result.applied.enterprise,
        result.statusEvents
      ),
    });
  } catch (error: unknown) {
    const { status, body } = enterpriseStatusChangeErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
