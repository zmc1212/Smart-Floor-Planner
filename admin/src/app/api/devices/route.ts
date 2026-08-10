import { NextResponse } from 'next/server';
import {
  deviceToDto,
  parsePostgresId,
} from '@/db/postgres-dto';
import {
  AdminUserRepository,
  DeviceRepository,
} from '@/db/repositories';
import { normalizeDeviceBindingStatus } from '@/lib/device-binding-status';
import {
  withDevicePostgresTransaction,
} from '@/lib/postgres-request-scope';
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

function parseAssignedUserIds(value: unknown) {
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

export async function GET(request: Request) {
  try {
    return await withTenantRoute(
      request,
      { roles: [...READ_ROLES] },
      async (context) => {
        const devices = await withDevicePostgresTransaction(
          context,
          (transaction) =>
            new DeviceRepository(transaction).list({
              assignedUserId:
                context.role === 'designer' ||
                context.role === 'salesperson' ||
                context.role === 'measurer'
                  ? parsePostgresId(context.userId, 'userId')
                  : undefined,
            })
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
        const code = typeof body.code === 'string' ? body.code.trim() : '';
        if (!code) {
          return NextResponse.json(
            { success: false, error: '设备编码不能为空' },
            { status: 400 }
          );
        }
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
            const assignedUserIds = parseAssignedUserIds(
              body.assignedUserIds ?? body.assignedUserId
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
            const enterpriseId = explicitEnterpriseId
              ? parsePostgresId(explicitEnterpriseId, 'enterpriseId')
              : resolvedAssignedUsers[0]?.enterpriseId ?? null;
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
            return new DeviceRepository(transaction).create(
              {
                code,
                description:
                  typeof body.description === 'string'
                    ? body.description.trim() || null
                    : null,
                enterpriseId,
                assignedUserId: assignedUserIds[0] ?? null,
                status: normalizeDeviceBindingStatus(
                  context.role === 'enterprise_admin' && status === 'unassigned'
                    ? 'assigned'
                    : status,
                  assignedUserIds.length > 0,
                  Boolean(enterpriseId)
                ),
              },
              assignedUserIds
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
            ? '设备编码已存在，请在列表中编辑该设备后添加绑定人员'
            : errorMessage(error),
      },
      { status: code === '23505' ? 409 : 500 }
    );
  }
}
