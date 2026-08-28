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
import { createPaginationMetadata, getPaginationParams } from '@/lib/pagination';

export const dynamic = 'force-dynamic';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

export async function GET(request: Request) {
  try {
    const context = await resolveMiniProgramPlatformAdmin(request);
    if (!context) return platformAdminForbiddenResponse();

    const url = new URL(request.url);
    const searchParams = url.searchParams;
    const parsed = parsePlatformEnterpriseListStatus(searchParams.get('status'));
    if ('error' in parsed) {
      return NextResponse.json(
        { success: false, error: parsed.error },
        { status: 400 }
      );
    }
    const { q } = parsePlatformEnterpriseListQuery(searchParams.get('q'));
    const { page, limit } = getPaginationParams(url);

    const data = await withPlatformTransaction(async (transaction) => {
      const repository = new EnterpriseRepository(transaction);
      const [rows, total] = await Promise.all([
        repository.listForPlatformReview({
          status: parsed.status,
          q,
          page,
          limit,
        }),
        repository.countForPlatformReview({
          status: parsed.status,
          q,
        }),
      ]);
      return {
        status: parsed.status,
        q,
        enterprises: rows.map((row) => toPlatformEnterpriseReviewDto(row)),
        pagination: createPaginationMetadata(total, page, limit),
      };
    });

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}
