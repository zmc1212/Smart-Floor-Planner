import { NextResponse } from 'next/server';
import { enterpriseToDto } from '@/db/postgres-dto';
import { withPlatformTransaction } from '@/db/transaction';
import {
  SelfServiceEnterpriseApplicationError,
  createSelfServiceEnterpriseApplication,
  parseSelfServiceEnterpriseApplicationBody,
  selfServiceEnterpriseApplicationHttpStatus,
} from '@/lib/self-service-enterprise-registration';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = parseSelfServiceEnterpriseApplicationBody(body);
    const enterprise = await withPlatformTransaction((transaction) =>
      createSelfServiceEnterpriseApplication(transaction, input)
    );

    return NextResponse.json({
      success: true,
      data: enterpriseToDto(enterprise),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        success: false,
        error: message,
        ...(error instanceof SelfServiceEnterpriseApplicationError
          ? { code: error.code }
          : {}),
      },
      { status: selfServiceEnterpriseApplicationHttpStatus(error) }
    );
  }
}
