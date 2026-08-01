import { NextResponse } from 'next/server';
import { SystemRoleRepository, type SystemRoleRecord } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import { getTenantContext } from '@/lib/auth';
import { DEFAULT_PERMISSIONS, ROLE_LABELS } from '@/models/AdminUser';

function toRoleDto(role: SystemRoleRecord) {
  return {
    _id: role.id.toString(),
    roleKey: role.roleKey,
    label: role.label,
    menuKeys: role.menuKeys,
    description: role.description,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

function parseRoleId(value: unknown) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    return null;
  }
  return BigInt(value);
}

async function authorizePlatformRole(request: Request) {
  const context = await getTenantContext(request);
  if (!context) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }
  if (context.role !== 'super_admin' && context.role !== 'admin') {
    return NextResponse.json(
      { success: false, error: 'Forbidden' },
      { status: 403 }
    );
  }
  return null;
}

// GET /api/roles - List all roles with auto-seeding
export async function GET(request: Request) {
  try {
    const unauthorized = await authorizePlatformRole(request);
    if (unauthorized) {
      return unauthorized;
    }

    const roles = await withPlatformTransaction(async (transaction) => {
      const repository = new SystemRoleRepository(transaction);
      const seedData = Object.entries(DEFAULT_PERMISSIONS).map(([key, menus]) => ({
        roleKey: key,
        label: ROLE_LABELS[key] || key,
        menuKeys: menus,
      }));

      await repository.ensureDefaults(seedData);
      return repository.list();
    });

    return NextResponse.json({
      success: true,
      data: roles.map(toRoleDto),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// PATCH /api/roles - Update permissions for a role
export async function PATCH(request: Request) {
  try {
    const unauthorized = await authorizePlatformRole(request);
    if (unauthorized) {
      return unauthorized;
    }

    const body = await request.json();
    const { id, menuKeys } = body;

    const roleId = parseRoleId(id);
    if (
      roleId === null ||
      !Array.isArray(menuKeys) ||
      menuKeys.some((menuKey) => typeof menuKey !== 'string')
    ) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    const role = await withPlatformTransaction((transaction) =>
      new SystemRoleRepository(transaction).updateMenuKeys(roleId, menuKeys)
    );

    if (!role) {
      return NextResponse.json({ success: false, error: 'Role not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: toRoleDto(role) });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
