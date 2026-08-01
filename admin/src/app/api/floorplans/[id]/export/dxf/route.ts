import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { FloorPlanRepository } from '@/db/repositories';
import { getTenantContext } from '@/lib/auth';
import { DXFGenerator } from '@/lib/dxf';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';
import { adaptSurveyGraphToRooms, isFormalSurveyLayout } from '@/lib/survey-graph';

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

    const plan = await withAdminPostgresTransaction(context, (transaction) =>
      new FloorPlanRepository(transaction).findById(
        parsePostgresId(id, 'floor plan id')
      )
    );
    if (!plan) {
      return NextResponse.json({ success: false, error: 'Floor plan not found' }, { status: 404 });
    }

    if (!isFormalSurveyLayout(plan.layoutData)) {
      return NextResponse.json({ success: false, error: 'Floor plan does not use the formal surveyGraph contract' }, { status: 400 });
    }

    const rooms = adaptSurveyGraphToRooms(plan.layoutData);
    const dxfGen = new DXFGenerator(plan.name || 'FloorPlan');
    const dxfString = dxfGen.generateFromData(rooms);

    // Return DXF as a downloadable file
    const response = new NextResponse(dxfString, {
      status: 200,
      headers: {
        'Content-Type': 'application/dxf',
        'Content-Disposition': `attachment; filename="FloorPlan_${plan.name || id}.dxf"`,
      },
    });

    return response;
  } catch (error: unknown) {
    console.error('DXF Export Error:', error);
    const message = error instanceof Error ? error.message : 'DXF export failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
