import { NextResponse } from 'next/server';
import {
  deviceToDto,
  parseOptionalPostgresId,
  parsePostgresId,
} from '@/db/postgres-dto';
import {
  AdminUserRepository,
  DeviceRepository,
} from '@/db/repositories';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';
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

export async function GET(request: Request) {
  try {
    return await withTenantRoute(
      request,
      { roles: [...READ_ROLES] },
      async (context) => {
        const devices = await withAdminPostgresTransaction(
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
        const device = await withAdminPostgresTransaction(
          context,
          async (transaction) => {
            const assignedUserId = parseOptionalPostgresId(
              body.assignedUserId,
              'assignedUserId'
            );
            const assignedUser = assignedUserId
              ? await new AdminUserRepository(transaction).findById(
                  assignedUserId
                )
              : null;
            if (assignedUserId && !assignedUser) {
              throw new Error('Assigned staff not found in this scope');
            }
            const enterpriseId = explicitEnterpriseId
              ? parsePostgresId(explicitEnterpriseId, 'enterpriseId')
              : assignedUser?.enterpriseId ?? null;
            if (
              assignedUser?.enterpriseId &&
              enterpriseId !== assignedUser.enterpriseId
            ) {
              throw new Error('Assigned staff belongs to another enterprise');
            }
            return new DeviceRepository(transaction).create({
              code,
              description:
                typeof body.description === 'string'
                  ? body.description.trim() || null
                  : null,
              enterpriseId,
              assignedUserId,
              status:
                context.role === 'enterprise_admin' && status === 'unassigned'
                  ? 'assigned'
                  : status,
            });
          }
        );

        return NextResponse.json(
          { success: true, data: device ? deviceToDto(device) : null },
          { status: 201 }
        );
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
