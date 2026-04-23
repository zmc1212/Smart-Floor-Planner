import { NextResponse } from 'next/server';
import { getTenantContext } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const context = await getTenantContext(request);

    if (!context) {
      return NextResponse.json({
        success: false,
        error: 'No tenant context found',
        debug: 'User not authenticated'
      }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      data: {
        userId: context.userId,
        role: context.role,
        enterpriseId: context.enterpriseId,
        username: context.username
      },
      debug: {
        hasEnterpriseId: !!context.enterpriseId,
        roleRequiresFiltering: !['super_admin', 'admin'].includes(context.role)
      }
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}