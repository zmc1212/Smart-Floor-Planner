import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { FloorPlan } from '@/models/FloorPlan';
import { DXFGenerator } from '@/lib/dxf';
import { adaptSurveyGraphToRooms, isFormalSurveyLayout } from '@/lib/survey-graph';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await dbConnect();
    const { id } = await params;

    const plan = await FloorPlan.findById(id);
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
