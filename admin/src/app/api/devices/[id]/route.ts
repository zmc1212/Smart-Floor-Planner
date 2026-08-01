import { NextResponse } from 'next/server';
import {
  deviceToDto,
  parseOptionalPostgresId,
  parsePostgresId,
} from '@/db/postgres-dto';
import {
  AdminUserRepository,
  DeviceRepository,
  type DeviceUpdate,
} from '@/db/repositories';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

const WRITE_ROLES = ['super_admin', 'admin', 'enterprise_admin'] as const;
const DEVICE_STATUSES = new Set([
  'unassigned',
  'assigned',
  'maintenance',
  'lost',
]);

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
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

        const device = await withAdminPostgresTransaction(
          context,
          async (transaction) => {
            const repository = new DeviceRepository(transaction);
            const current = await repository.findById(deviceId);
            if (!current) return null;

            const input: DeviceUpdate = {};
            if (body.code !== undefined) {
              const code = String(body.code).trim();
              if (!code) throw new Error('设备编码不能为空');
              input.code = code;
            }
            if (body.description !== undefined) {
              input.description = String(body.description).trim() || null;
            }
            if (body.status !== undefined) input.status = body.status;

            const assignedUserId =
              body.assignedUserId !== undefined
                ? parseOptionalPostgresId(
                    body.assignedUserId,
                    'assignedUserId'
                  )
                : current.assignedUserId;
            const assignedUser = assignedUserId
              ? await new AdminUserRepository(transaction).findById(
                  assignedUserId
                )
              : null;
            if (assignedUserId && !assignedUser) {
              throw new Error('Assigned staff not found in this scope');
            }

            let enterpriseId = current.enterpriseId;
            if (context.role === 'enterprise_admin') {
              enterpriseId = parsePostgresId(
                context.enterpriseId,
                'enterpriseId'
              );
            } else if (body.enterpriseId !== undefined) {
              enterpriseId = parseOptionalPostgresId(
                body.enterpriseId,
                'enterpriseId'
              );
            }
            if (!enterpriseId && assignedUser?.enterpriseId) {
              enterpriseId = assignedUser.enterpriseId;
            }
            if (
              assignedUser?.enterpriseId &&
              enterpriseId !== assignedUser.enterpriseId
            ) {
              throw new Error('Assigned staff belongs to another enterprise');
            }
            input.enterpriseId = enterpriseId;
            input.assignedUserId = assignedUserId;

            return repository.update(deviceId, input);
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
    const details = error as { code?: string };
    return NextResponse.json(
      {
        success: false,
        error:
          details.code === '23505'
            ? '设备编码已存在'
            : errorMessage(error),
      },
      { status: details.code === '23505' ? 400 : 500 }
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
