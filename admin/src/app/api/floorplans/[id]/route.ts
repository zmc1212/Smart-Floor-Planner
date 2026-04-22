import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { FloorPlan } from '@/models/FloorPlan';

export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    await dbConnect();
    const { id } = params;
    const body = await req.json();

    const updatedPlan = await FloorPlan.findByIdAndUpdate(
      id,
      { 
        $set: {
          name: body.name,
          layoutData: body.layoutData,
          status: body.status
        }
      },
      { new: true }
    );

    if (!updatedPlan) {
      return NextResponse.json({ success: false, error: 'FloorPlan not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: updatedPlan });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    await dbConnect();
    const { id } = params;
    await FloorPlan.findByIdAndDelete(id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
