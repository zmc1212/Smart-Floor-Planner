import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { FloorPlan } from '@/models/FloorPlan';
import { DXFGenerator } from '@/lib/dxf';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    await dbConnect();
    const id = params.id;

    const plan = await FloorPlan.findById(id);
    if (!plan) {
      return NextResponse.json({ success: false, error: 'Floor plan not found' }, { status: 404 });
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
  } catch (error: any) {
    console.error('DXF Export Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
