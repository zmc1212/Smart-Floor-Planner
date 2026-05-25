import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { getTenantContext } from '@/lib/auth';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { searchKujialeFloorPlans } from '@/lib/kujiale';

export const dynamic = 'force-dynamic';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

export async function GET(request: Request) {
  try {
    await dbConnect();

    const mpContext = await resolveMiniProgramContext(request);
    const adminContext = mpContext ? null : await getTenantContext(request);

    if (!mpContext && !adminContext) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const communityName = searchParams.get('communityName')?.trim();

    if (!communityName) {
      return NextResponse.json({ success: false, error: 'communityName is required' }, { status: 400 });
    }

    const result = await searchKujialeFloorPlans({
      city: searchParams.get('city') || undefined,
      communityName,
      area: searchParams.get('area'),
      layout: searchParams.get('layout'),
      page: Number(searchParams.get('page') || '1'),
      limit: Number(searchParams.get('limit') || '10'),
    });

    return NextResponse.json({ success: true, data: result.items, pagination: result.pagination });
  } catch (error: unknown) {
    console.error('KuJiale floor plan search error:', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
