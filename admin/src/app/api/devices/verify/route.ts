import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import dbConnect from '@/lib/mongodb';
import { Device } from '@/models/Device';

export async function POST(request: Request) {
  await dbConnect();
  try {
    const { deviceId, name } = await request.json();
    
    const devices = await Device.find().lean();
    
    // If no devices in DB, we should probably still reject (deep binding)
    // Or allow all if empty? Requirement: "only connect to devices listed in the backend"
    
    const isAuthorized = devices.some(d => {
      const code = d.code.toUpperCase();
      const devIdUpper = (deviceId || '').toUpperCase();
      const nameUpper = (name || '').toUpperCase();
      
      return devIdUpper.includes(code) || nameUpper.includes(code);
    });

    return NextResponse.json({ success: true, authorized: isAuthorized });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
