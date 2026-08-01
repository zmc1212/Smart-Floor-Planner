import { NextResponse } from 'next/server';
import { DeviceRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { deviceId, name } = await request.json();
    const reportedId = String(deviceId || '').toUpperCase();
    const reportedName = String(name || '').toUpperCase();
    const devices = await withPlatformTransaction((transaction) =>
      new DeviceRepository(transaction).list()
    );
    const authorized = devices.some((device) => {
      const code = device.code.toUpperCase();
      return reportedId.includes(code) || reportedName.includes(code);
    });
    return NextResponse.json({ success: true, authorized });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
