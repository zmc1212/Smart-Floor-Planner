import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { FloorPlanRepository } from '@/db/repositories';
import { getTenantContext } from '@/lib/auth';
import {
  DxfExportError,
  dxfContentDisposition,
  generateFormalSurveyDxf,
} from '@/lib/dxf';
import { resolveFormalSurveyDxfSheet } from '@/lib/dxf-export-sheet';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';
import { isFormalSurveyLayout } from '@/lib/survey-graph';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await getTenantContext(request);
    if (!context) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;

    const loaded = await withAdminPostgresTransaction(context, async (transaction) => {
      const plan = await new FloorPlanRepository(transaction).findById(
        parsePostgresId(id, 'floor plan id')
      );
      if (!plan) return null;
      const { sheet, fileName } = await resolveFormalSurveyDxfSheet(transaction, plan);
      return { plan, sheet, fileName };
    });
    if (!loaded) {
      return NextResponse.json({ success: false, error: 'Floor plan not found' }, { status: 404 });
    }

    if (!isFormalSurveyLayout(loaded.plan.layoutData)) {
      return NextResponse.json({ success: false, error: 'Floor plan does not use the formal surveyGraph contract' }, { status: 400 });
    }

    const dxfString = generateFormalSurveyDxf(loaded.plan.layoutData, loaded.plan.status, loaded.sheet);

    const response = new NextResponse(dxfString, {
      status: 200,
      headers: {
        'Content-Type': 'application/dxf',
        'Content-Disposition': dxfContentDisposition(loaded.fileName, id),
        'Cache-Control': 'private, no-store',
      },
    });

    return response;
  } catch (error: unknown) {
    console.error('DXF Export Error:', error);
    if (error instanceof DxfExportError) {
      return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'DXF export failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
