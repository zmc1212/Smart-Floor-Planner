import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { Device } from '@/models/Device';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await dbConnect();
  try {
    const { id } = await params;
    const body = await request.json();
    const { code, description } = body;

    const device = await Device.findByIdAndUpdate(
      id,
      { code: code?.trim(), description: description?.trim() },
      { new: true, runValidators: true }
    );

    if (!device) {
      return NextResponse.json({ success: false, error: '设备不存在' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: device });
  } catch (error: any) {
    if (error.code === 11000) {
      return NextResponse.json({ success: false, error: '设备编码已存在' }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await dbConnect();
  try {
    const { id } = await params;
    await Device.findByIdAndDelete(id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
