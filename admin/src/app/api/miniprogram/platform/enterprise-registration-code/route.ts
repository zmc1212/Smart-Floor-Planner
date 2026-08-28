import { NextResponse } from 'next/server';
import { EnterpriseRegistrationCodeRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { enterpriseRegistrationCodeToDto } from '@/lib/enterprise-registration-api';
import {
  platformAdminForbiddenResponse,
  resolveMiniProgramPlatformAdmin,
} from '@/lib/miniprogram-platform-enterprises';

export const dynamic = 'force-dynamic';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

export async function GET(request: Request) {
  try {
    const context = await resolveMiniProgramPlatformAdmin(request);
    if (!context) return platformAdminForbiddenResponse();

    const code = await withPlatformTransaction(async (transaction) => {
      return new EnterpriseRegistrationCodeRepository(transaction).getActiveCode();
    });

    return NextResponse.json({
      success: true,
      data: {
        code: code ? enterpriseRegistrationCodeToDto(code) : null,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}
