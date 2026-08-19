import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { FloorPlanRepository } from '@/db/repositories';
import { canAccessMiniProgramFloorPlan } from '@/lib/floor-plan-access';
import {
  DxfExportError,
  dxfContentDisposition,
  generateFormalSurveyDxf,
} from '@/lib/dxf';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const plan = await withMiniProgramPostgresTransaction(context, (transaction) =>
      new FloorPlanRepository(transaction).findById(parsePostgresId(id, 'floor plan id'))
    );
    if (!plan || !canAccessMiniProgramFloorPlan(plan, context)) {
      return NextResponse.json({ success: false, error: 'Floor plan not found' }, { status: 404 });
    }

    const dxf = generateFormalSurveyDxf(plan.layoutData, plan.status);
    return new NextResponse(dxf, {
      status: 200,
      headers: {
        'Content-Type': 'application/dxf; charset=utf-8',
        'Content-Disposition': dxfContentDisposition(plan.name, id),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error: unknown) {
    if (error instanceof DxfExportError) {
      return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error('Mini Program DXF Export Error:', error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'DXF export failed' }, { status: 500 });
  }
}
