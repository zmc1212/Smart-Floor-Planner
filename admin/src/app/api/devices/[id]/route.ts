import { NextResponse } from 'next/server';
import {
  deviceToDto,
  parseOptionalPostgresId,
  parsePostgresId,
} from '@/db/postgres-dto';
import {
  DeviceRepository,
  type DeviceUpdate,
} from '@/db/repositories';
import { normalizeDeviceBindingStatus } from '@/lib/device-binding-status';
import {
  withAdminPostgresTransaction,
  withDevicePostgresTransaction,
} from '@/lib/postgres-request-scope';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    return await withTenantRoute(
      request,
      { roles: [...WRITE_ROLES] },
      async (context) => {
        const { id } = await params;
        const deviceId = parsePostgresId(id, 'device id');
        const body = await request.json();
        if (body.status !== undefined && !DEVICE_STATUSES.has(body.status)) {
          return NextResponse.json(
            { success: false, error: '设备状态无效' },
            { status: 400 }
          );
        }

        const device = await withDevicePostgresTransaction(
          context,
          async (transaction) => {
            const repository = new DeviceRepository(transaction);
            const current = await repository.findById(deviceId);
            if (!current) return null;

            const input: DeviceUpdate = {};
            if (body.code !== undefined) {
              const code = String(body.code).trim().toUpperCase();
              if (!code) throw new Error('设备编码不能为空');
              input.code = code;
            }
            if (body.description !== undefined) {
              input.description = String(body.description).trim() || null;
            }
            const requestedStatus = body.status ?? current.status;

            let enterpriseId = current.enterpriseId;
            if (body.enterpriseId !== undefined) {
              enterpriseId = parseOptionalPostgresId(
                body.enterpriseId,
                'enterpriseId'
              );
            }
            input.status = normalizeDeviceBindingStatus(
              requestedStatus,
              Boolean(enterpriseId)
            );
            input.enterpriseId = enterpriseId;
            input.assignedUserId = null;

            return repository.update(deviceId, input, []);
          }
        );
        if (!device) {
          return NextResponse.json(
            { success: false, error: '设备不存在或无权操作' },
            { status: 404 }
          );
        }
        return NextResponse.json({ success: true, data: deviceToDto(device) });
      }
    );
  } catch (error: unknown) {
    const code = postgresErrorCode(error);
    return NextResponse.json(
      {
        success: false,
        error: code === '23505' ? '设备编码已存在' : errorMessage(error),
      },
      { status: code === '23505' ? 409 : 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    return await withTenantRoute(
      request,
      { roles: [...WRITE_ROLES] },
      async (context) => {
        const { id } = await params;
        const deleted = await withAdminPostgresTransaction(
          context,
          (transaction) =>
            new DeviceRepository(transaction).delete(
              parsePostgresId(id, 'device id')
            )
        );
        if (!deleted) {
          return NextResponse.json(
            { success: false, error: '设备不存在或无权操作' },
            { status: 404 }
          );
        }
        return NextResponse.json({ success: true });
      }
    );
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}
