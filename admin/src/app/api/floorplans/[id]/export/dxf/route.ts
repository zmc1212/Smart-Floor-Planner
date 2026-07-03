import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { FloorPlan } from '@/models/FloorPlan';
import { DXFGenerator } from '@/lib/dxf';

function isSurveyingPrototypeLayout(layoutData: unknown) {
  const parsed = layoutData && typeof layoutData === 'object' ? layoutData as {
    measurementMode?: string;
    prototypeOnly?: boolean;
    surveyDraft?: { kind?: string };
  } : null;
  return Boolean(
    parsed &&
    !Array.isArray(layoutData) &&
    parsed.measurementMode === 'surveying_prototype' &&
    parsed.prototypeOnly === true &&
    parsed.surveyDraft?.kind === 'survey-wall-graph'
  );
}

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

    if (isSurveyingPrototypeLayout(plan.layoutData)) {
      return NextResponse.json({ success: false, error: 'Surveying prototype drafts cannot be exported to DXF' }, { status: 400 });
    }

    const rooms = plan.layoutData || [];
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
