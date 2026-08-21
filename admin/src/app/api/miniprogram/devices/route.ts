import { NextResponse } from 'next/server';
import {
  deviceToDto,
  enterpriseToDto,
  parsePostgresId,
} from '@/db/postgres-dto';
import {
  DeviceRepository,
  EnterpriseRepository,
  type DeviceWithRelations,
} from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { normalizeDeviceBindingStatus } from '@/lib/device-binding-status';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';

export const dynamic = 'force-dynamic';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function postgresErrorCode(error: unknown) {
  const details = error as { code?: string; cause?: { code?: string } };
  return details.code ?? details.cause?.code;
}

function isPlatformAdmin(role?: string | null) {
  return role === 'super_admin' || role === 'admin';
}

function parseDeviceCodes(body: {
  code?: unknown;
  devices?: unknown;
}): Array<{ code: string; description: string | null }> {
  if (Array.isArray(body.devices)) {
    const byCode = new Map<string, { code: string; description: string | null }>();
    for (const item of body.devices) {
      const raw =
        typeof item === 'string'
          ? item
          : item && typeof item === 'object' && 'code' in item
            ? (item as { code?: unknown }).code
            : null;
      const code = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
      if (!code) continue;
      const description =
        item &&
        typeof item === 'object' &&
        'description' in item &&
        typeof (item as { description?: unknown }).description === 'string'
          ? String((item as { description: string }).description).trim() || null
          : null;
      byCode.set(code, { code, description });
    }
    return [...byCode.values()];
  }
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!code) return [];
  return [{ code, description: null }];
}

async function upsertDeviceForEnterprise(
  devices: DeviceRepository,
  input: {
    code: string;
    enterpriseId: bigint;
    description: string | null;
  }
): Promise<DeviceWithRelations | null> {
  const existing = await devices.findByCode(input.code);
  if (existing) {
    return devices.update(
      existing.id,
      {
        enterpriseId: input.enterpriseId,
        description:
          input.description !== null ? input.description : existing.description,
        assignedUserId: null,
        status: normalizeDeviceBindingStatus(
          existing.status === 'maintenance' || existing.status === 'lost'
            ? existing.status
            : 'assigned',
          true
        ),
      },
      []
    );
  }
  return devices.create(
    {
      code: input.code,
      description: input.description,
      enterpriseId: input.enterpriseId,
      assignedUserId: null,
      status: normalizeDeviceBindingStatus('assigned', true),
    },
    []
  );
}

export async function GET(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context?.staff || !isPlatformAdmin(context.staff.role)) {
      return NextResponse.json(
        { success: false, error: '需要平台管理员身份' },
        { status: 403 }
      );
    }

    const url = new URL(request.url);
    const enterpriseFilter = url.searchParams.get('enterpriseId');

    const data = await withPlatformTransaction(async (transaction) => {
      const [deviceRows, enterpriseRows] = await Promise.all([
        new DeviceRepository(transaction).list(),
        new EnterpriseRepository(transaction).list(),
      ]);
      const devices = enterpriseFilter
        ? deviceRows.filter(
            (device) =>
              device.enterpriseId?.toString() === enterpriseFilter
          )
        : deviceRows;
      return {
        devices: devices.map(deviceToDto),
        enterprises: enterpriseRows.map((enterprise) =>
          enterpriseToDto(enterprise)
        ),
      };
    });

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveMiniProgramContext(request);
    if (!context?.staff || !isPlatformAdmin(context.staff.role)) {
      return NextResponse.json(
        { success: false, error: '需要平台管理员身份' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const entries = parseDeviceCodes(body);
    if (entries.length === 0) {
      return NextResponse.json(
        { success: false, error: '设备 MAC（deviceId）不能为空' },
        { status: 400 }
      );
    }
    if (body.enterpriseId == null || body.enterpriseId === '') {
      return NextResponse.json(
        { success: false, error: '请选择归属企业' },
        { status: 400 }
      );
    }

    const enterpriseId = parsePostgresId(body.enterpriseId, 'enterpriseId');
    const sharedDescription =
      typeof body.description === 'string'
        ? body.description.trim() || null
        : null;

    const result = await withPlatformTransaction(async (transaction) => {
      const enterprises = new EnterpriseRepository(transaction);
      const devices = new DeviceRepository(transaction);
      const enterprise = await enterprises.findById(enterpriseId);
      if (!enterprise) {
        throw new Error('企业不存在');
      }

      const upserted: DeviceWithRelations[] = [];
      for (const entry of entries) {
        const device = await upsertDeviceForEnterprise(devices, {
          code: entry.code,
          enterpriseId,
          description: entry.description ?? sharedDescription,
        });
        if (device) upserted.push(device);
      }
      return upserted;
    });

    if (entries.length === 1) {
      return NextResponse.json(
        { success: true, data: result[0] ? deviceToDto(result[0]) : null },
        { status: 201 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          assignedCount: result.length,
          devices: result.map(deviceToDto),
        },
      },
      { status: 201 }
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
