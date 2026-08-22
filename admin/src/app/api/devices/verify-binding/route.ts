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

function normalizeBleIdentity(value: string): string {
  return String(value || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
}

function identitiesMatch(reported: string, code: string): boolean {
  const left = normalizeBleIdentity(reported);
  const right = normalizeBleIdentity(code);
  if (!left || !right) return false;
  return left.includes(right) || right.includes(left);
}

export async function POST(request: Request) {
  try {
    const { deviceId, name, openid, advertisDataHex } = await request.json();
    if (!deviceId) {
      return NextResponse.json(
        { success: false, error: '未提供设备 ID' },
        { status: 400 }
      );
    }

    const context = await resolveMiniProgramContext(request);
    const reportedId = String(deviceId);
    const reportedName = String(name || '');
    const reportedAdvertis = String(advertisDataHex || '');
    const result = await withPlatformTransaction(async (transaction) => {
      const devices = await new DeviceRepository(transaction).list({
        status: 'assigned',
      });
      const matchedDevice = devices.find((device) => {
        const code = device.code;
        return (
          identitiesMatch(reportedId, code) ||
          identitiesMatch(reportedName, code) ||
          identitiesMatch(reportedAdvertis, code)
        );
      });
      if (!matchedDevice) {
        return {
          authorized: false,
          message: '该设备未在系统中注册或未指派企业',
        };
      }
      if (!matchedDevice.enterpriseId) {
        return {
          authorized: false,
          message: '该设备未分配企业，无法使用',
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
      if (matchedDevice.enterpriseId !== staff.enterpriseId) {
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
