import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import {
  AdminUserRepository,
  DeviceRepository,
  type AdminUserRecord,
} from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { deviceId, name, openid } = await request.json();
    if (!deviceId) {
      return NextResponse.json(
        { success: false, error: '未提供设备 ID' },
        { status: 400 }
      );
    }

    const context = await resolveMiniProgramContext(request);
    const reportedId = String(deviceId).toUpperCase();
    const reportedName = String(name || '').toUpperCase();
    const result = await withPlatformTransaction(async (transaction) => {
      const devices = await new DeviceRepository(transaction).list({
        status: 'assigned',
      });
      const matchedDevice = devices.find((device) => {
        const code = device.code.toUpperCase();
        return reportedId.includes(code) || reportedName.includes(code);
      });
      if (!matchedDevice) {
        return {
          authorized: false,
          message: '该设备未在系统中注册或未指派',
        };
      }

      let staff: AdminUserRecord | null = context?.staff
        ? await new AdminUserRepository(transaction).findById(
            parsePostgresId(context.staff._id, 'staff id')
          )
        : null;
      if (!staff && typeof openid === 'string' && openid.trim()) {
        staff = await new AdminUserRepository(transaction).findByOpenidOrPhone(
          openid.trim()
        );
      }
      if (!staff) {
        return {
          authorized: false,
          message: '未能识别当前员工，无法验证设备授权',
        };
      }
      if (
        matchedDevice.assignedUserId &&
        matchedDevice.assignedUserId !== staff.id
      ) {
        return {
          authorized: false,
          message: '该设备已绑定给其他员工，您无权使用',
        };
      }
      if (
        matchedDevice.enterpriseId &&
        matchedDevice.enterpriseId !== staff.enterpriseId
      ) {
        return {
          authorized: false,
          message: '您无权使用该公司的设备',
        };
      }
      return { authorized: true, message: '设备验证通过' };
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Verify binding error:', error);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
