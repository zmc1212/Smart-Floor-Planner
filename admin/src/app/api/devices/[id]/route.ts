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
import { normalizeDeviceBindingStatus } from '@/lib/device-binding-status';
import {
  withAdminPostgresTransaction,
  withDevicePostgresTransaction,
} from '@/lib/postgres-request-scope';
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

function postgresErrorCode(error: unknown) {
  const details = error as { code?: string; cause?: { code?: string } };
  return details.code ?? details.cause?.code;
}

function parseAssignedUserIds(value: unknown, fallback: bigint[]) {
  if (value === undefined) return fallback;
  const rawValues = Array.isArray(value) ? value : value == null ? [] : [value];
  const ids = new Map<string, bigint>();
  for (const value of rawValues) {
    if (value == null || value === '') continue;
    const id = parsePostgresId(value, 'assignedUserIds');
    ids.set(id.toString(), id);
  }
  return [...ids.values()];
}

function isAssignedUser(
  user: Awaited<ReturnType<AdminUserRepository['findById']>>
): user is NonNullable<Awaited<ReturnType<AdminUserRepository['findById']>>> {
  return Boolean(user);
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
              const code = String(body.code).trim();
              if (!code) throw new Error('设备编码不能为空');
              input.code = code;
            }
            if (body.description !== undefined) {
              input.description = String(body.description).trim() || null;
            }
            const requestedStatus = body.status ?? current.status;

            const assignedUserIds = parseAssignedUserIds(
              body.assignedUserIds ?? body.assignedUserId,
              current.assignedUsers.map((assignedUser) => assignedUser.id)
            );
            const assignedUsers = await Promise.all(
              assignedUserIds.map((assignedUserId) =>
                new AdminUserRepository(transaction).findById(assignedUserId)
              )
            );
            if (assignedUsers.some((assignedUser) => !assignedUser)) {
              throw new Error('Assigned staff not found in this scope');
            }
            const resolvedAssignedUsers = assignedUsers.filter(
              isAssignedUser
            );

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
            if (!enterpriseId && resolvedAssignedUsers[0]?.enterpriseId) {
              enterpriseId = resolvedAssignedUsers[0].enterpriseId;
            }
            if (
              resolvedAssignedUsers.some(
                (assignedUser) => assignedUser.enterpriseId !== enterpriseId
              )
            ) {
              throw new Error(
                enterpriseId
                  ? 'Assigned staff belongs to another enterprise'
                  : 'An unassigned device can only be assigned to staff without an enterprise'
              );
            }
            input.status = normalizeDeviceBindingStatus(
              requestedStatus,
              assignedUserIds.length > 0,
              Boolean(enterpriseId)
            );
            input.enterpriseId = enterpriseId;
            input.assignedUserId = assignedUserIds[0] ?? null;

            return repository.update(deviceId, input, assignedUserIds);
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
        error:
          code === '23505'
            ? '设备编码已存在'
            : errorMessage(error),
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
