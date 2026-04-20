import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import dbConnect from '@/lib/mongodb';
import { Device } from '@/models/Device';
import { Enterprise } from '@/models/Enterprise';
import { AdminUser } from '@/models/AdminUser';

export async function GET(request: Request) {
  await dbConnect();
  try {
    const devices = await Device.find()
      .populate({ path: 'enterpriseId', model: Enterprise, select: 'name' })
      .populate({ path: 'assignedUserId', model: AdminUser, select: 'displayName username' })
      .sort({ createdAt: -1 })
      .lean();
    return NextResponse.json({ success: true, data: devices });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  await dbConnect();
  try {
    const body = await request.json();
    const device = await Device.create(body);
    return NextResponse.json({ success: true, data: device });
  } catch (error: any) {
    if (error.code === 11000) {
      return NextResponse.json({ success: false, error: '设备编码已存在' }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
