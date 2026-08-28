import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { EnterpriseRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import {
  platformAdminForbiddenResponse,
  resolveMiniProgramPlatformAdmin,
  toPlatformEnterpriseReviewDto,
} from '@/lib/miniprogram-platform-enterprises';

export const dynamic = 'force-dynamic';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await resolveMiniProgramPlatformAdmin(request);
    if (!context) return platformAdminForbiddenResponse();

    const { id } = await params;
    const enterpriseId = parsePostgresId(id);
    const data = await withPlatformTransaction(async (transaction) => {
      const enterprises = new EnterpriseRepository(transaction);
      const enterprise = await enterprises.findById(enterpriseId);
      if (!enterprise) return null;
      const statusEvents = await enterprises.listStatusEvents(enterpriseId, 20);
      return toPlatformEnterpriseReviewDto(enterprise, statusEvents);
    });

    if (!data) {
      return NextResponse.json(
        { success: false, error: 'Enterprise not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}
