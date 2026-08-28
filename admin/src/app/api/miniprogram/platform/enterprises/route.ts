import { NextResponse } from 'next/server';
import { EnterpriseRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import {
  parsePlatformEnterpriseListQuery,
  parsePlatformEnterpriseListStatus,
  platformAdminForbiddenResponse,
  resolveMiniProgramPlatformAdmin,
  toPlatformEnterpriseReviewDto,
} from '@/lib/miniprogram-platform-enterprises';

export const dynamic = 'force-dynamic';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

export async function GET(request: Request) {
  try {
    const context = await resolveMiniProgramPlatformAdmin(request);
    if (!context) return platformAdminForbiddenResponse();

    const searchParams = new URL(request.url).searchParams;
    const parsed = parsePlatformEnterpriseListStatus(searchParams.get('status'));
    if ('error' in parsed) {
      return NextResponse.json(
        { success: false, error: parsed.error },
        { status: 400 }
      );
    }
    const { q } = parsePlatformEnterpriseListQuery(searchParams.get('q'));

    const rows = await withPlatformTransaction(async (transaction) => {
      return new EnterpriseRepository(transaction).listForPlatformReview({
        status: parsed.status,
        q,
      });
    });

    return NextResponse.json({
      success: true,
      data: {
        status: parsed.status,
        q,
        enterprises: rows.map((row) => toPlatformEnterpriseReviewDto(row)),
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}
