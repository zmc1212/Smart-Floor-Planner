import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { ActionPermissionRepository, AdminUserRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { LEAD_ARCHIVE_CAPABILITY } from '@/lib/lead-lifecycle';
import { withTenantRoute } from '@/lib/tenant-route';

const CONFIGURABLE_ROLES = ['designer', 'measurer'] as const;
const EFFECTS = new Set(['inherit', 'allow', 'deny']);

export async function GET(request: Request) {
  try {
    return await withTenantRoute(
      request,
      { roles: ['enterprise_admin', 'super_admin', 'admin'], requireEnterprise: true },
      async (context) => {
        const data = await withTenantTransaction(context.enterpriseId!, async (transaction) => {
          const permissions = new ActionPermissionRepository(transaction);
          const staff = await new AdminUserRepository(transaction).list({
            roles: [...CONFIGURABLE_ROLES],
            page: 1,
            limit: 1000,
          });
          const ids = staff.rows.map((member) => member.id);
          const [defaults, overrides] = await Promise.all([
            permissions.getRoleDefaults(BigInt(context.enterpriseId!), LEAD_ARCHIVE_CAPABILITY),
            permissions.getUserOverrides(BigInt(context.enterpriseId!), LEAD_ARCHIVE_CAPABILITY, ids),
          ]);
          return {
            capabilityKey: LEAD_ARCHIVE_CAPABILITY,
            roleDefaults: Object.fromEntries(
              CONFIGURABLE_ROLES.map((role) => [role, defaults.get(role) ?? false])
            ),
            staff: staff.rows.map((member) => {
              const override = overrides.get(member.id);
              const effect = override === undefined ? 'inherit' : override ? 'allow' : 'deny';
              return {
                _id: member.id.toString(),
                displayName: member.displayName,
                username: member.username,
                role: member.role,
                effect,
                effectiveAllowed: override ?? defaults.get(member.role) ?? false,
              };
            }),
          };
        });
        return NextResponse.json({ success: true, data });
      }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '读取操作权限失败' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    return await withTenantRoute(
      request,
      { roles: ['enterprise_admin', 'super_admin', 'admin'], requireEnterprise: true },
      async (context) => {
        const body = await request.json();
        const roleDefaults = body.roleDefaults as Record<string, unknown> | undefined;
        const userOverrides = Array.isArray(body.userOverrides) ? body.userOverrides : [];
        if (
          !roleDefaults ||
          CONFIGURABLE_ROLES.some((role) => typeof roleDefaults[role] !== 'boolean') ||
          userOverrides.some((item: unknown) => {
            const record = item as { userId?: unknown; effect?: unknown };
            return typeof record.userId !== 'string' || !EFFECTS.has(String(record.effect));
          })
        ) {
          return NextResponse.json({ success: false, error: '权限配置格式无效' }, { status: 400 });
        }
        const updatedBy = parsePostgresId(context.userId, 'userId');
        const result = await withTenantTransaction(context.enterpriseId!, async (transaction) => {
          const staffRepository = new AdminUserRepository(transaction);
          const parsedOverrides = [];
          for (const item of userOverrides as Array<{ userId: string; effect: 'inherit' | 'allow' | 'deny' }>) {
            const userId = parsePostgresId(item.userId, 'userId');
            const member = await staffRepository.findById(userId);
            if (!member || !CONFIGURABLE_ROLES.includes(member.role as typeof CONFIGURABLE_ROLES[number])) {
              return null;
            }
            parsedOverrides.push({ userId, effect: item.effect });
          }
          await new ActionPermissionRepository(transaction).replacePolicy({
            enterpriseId: BigInt(context.enterpriseId!),
            capabilityKey: LEAD_ARCHIVE_CAPABILITY,
            updatedBy,
            roleDefaults: {
              designer: Boolean(roleDefaults.designer),
              measurer: Boolean(roleDefaults.measurer),
            },
            userOverrides: parsedOverrides,
          });
          return true;
        });
        if (!result) {
          return NextResponse.json({ success: false, error: '员工不存在或不属于可配置角色' }, { status: 400 });
        }
        return NextResponse.json({ success: true, data: {} });
      }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '保存操作权限失败' },
      { status: 500 }
    );
  }
}
