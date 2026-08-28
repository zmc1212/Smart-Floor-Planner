import { NextResponse } from 'next/server';
import {
  deviceToDto,
  parsePostgresId,
} from '@/db/postgres-dto';
import { DeviceRepository } from '@/db/repositories';
import { normalizeDeviceBindingStatus } from '@/lib/device-binding-status';
import { duplicateDeviceMessage, normalizeDeviceSerialNumber } from '@/lib/device-serial-number';
import { withDevicePostgresTransaction } from '@/lib/postgres-request-scope';
import {
  resolveWritableEnterpriseId,
  withTenantRoute,
} from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

const READ_ROLES = [
  'super_admin',
  'admin',
  'enterprise_admin',
  'designer',
  'salesperson',
  'measurer',
] as const;
const WRITE_ROLES = ['super_admin', 'admin'] as const;
const DEVICE_STATUSES = new Set([
  'unassigned',
  'assigned',
  'maintenance',
  'lost',
]);

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function postgresErrorCode(error: unknown) {
  const details = error as { code?: string; cause?: { code?: string } };
  return details.code ?? details.cause?.code;
}

export async function GET(request: Request) {
  try {
    return await withTenantRoute(
      request,
      { roles: [...READ_ROLES] },
      async (context) => {
        const devices = await withDevicePostgresTransaction(
          context,
          (transaction) => new DeviceRepository(transaction).list()
        );
        return NextResponse.json({
          success: true,
          data: devices.map(deviceToDto),
        });
      }
    );
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    return await withTenantRoute(
      request,
      { roles: [...WRITE_ROLES] },
      async (context) => {
        const body = await request.json();
        const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
        if (!code) {
          return NextResponse.json(
            { success: false, error: '设备编码不能为空' },
            { status: 400 }
          );
        }
        const serialNumber = normalizeDeviceSerialNumber(body.serialNumber);
        const status = body.status || 'unassigned';
        if (!DEVICE_STATUSES.has(status)) {
          return NextResponse.json(
            { success: false, error: '设备状态无效' },
            { status: 400 }
          );
        }

        const explicitEnterpriseId = resolveWritableEnterpriseId(
          context,
          body.enterpriseId
        );
        const device = await withDevicePostgresTransaction(
          context,
          async (transaction) => {
            const enterpriseId = explicitEnterpriseId
              ? parsePostgresId(explicitEnterpriseId, 'enterpriseId')
              : null;
            return new DeviceRepository(transaction).create(
              {
                code,
                serialNumber,
                description:
                  typeof body.description === 'string'
                    ? body.description.trim() || null
                    : null,
                enterpriseId,
                assignedUserId: null,
                status: normalizeDeviceBindingStatus(status, Boolean(enterpriseId)),
              },
              []
            );
          }
        );

        return NextResponse.json(
          { success: true, data: device ? deviceToDto(device) : null },
          { status: 201 }
        );
      }
    );
  } catch (error: unknown) {
    const code = postgresErrorCode(error);
    return NextResponse.json(
      {
        success: false,
        error:
          code === '23505'
            ? duplicateDeviceMessage(error, { createCopy: true })
            : errorMessage(error),
      },
      { status: code === '23505' ? 409 : 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    return await withTenantRoute(
      request,
      { roles: [...WRITE_ROLES] },
      async (context) => {
        const body = await request.json();
        if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 100) {
          return NextResponse.json(
            { success: false, error: '请选择 1-100 台设备进行删除' },
            { status: 400 }
          );
        }

        const ids = [
          ...new Set(
            body.ids.map((id: unknown) => parsePostgresId(String(id), 'device id'))
          ),
        ];
        const deleted = await withDevicePostgresTransaction(
          context,
          (transaction) => new DeviceRepository(transaction).deleteMany(ids)
        );
        const deletedIds = deleted.map((row) => row.id.toString());
        return NextResponse.json({
          success: true,
          data: {
            deletedCount: deletedIds.length,
            deletedIds,
          },
        });
      }
    );
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}
