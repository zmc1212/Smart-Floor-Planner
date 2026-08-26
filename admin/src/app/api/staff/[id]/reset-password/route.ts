import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AdminUserRepository } from '@/db/repositories';
import { withTenantTransaction } from '@/db/transaction';
import { hashStaffInitialPassword } from '@/lib/enterprise-admin-provision';
import { withTenantRoute } from '@/lib/tenant-route';

const RESETTABLE_ROLES = new Set([
  'enterprise_admin',
  'designer',
  'measurer',
  'salesperson',
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withTenantRoute(
    request,
    {
      roles: ['enterprise_admin', 'super_admin', 'admin'],
      requireEnterprise: true,
    },
    async (context) => {
      const { id } = await params;
      const staffId = parsePostgresId(id, 'staff id');
      const actorId = parsePostgresId(context.userId, 'actor id');
      if (staffId === actorId) {
        return NextResponse.json(
          { success: false, error: '请通过头像菜单修改自己的登录密码' },
          { status: 400 }
        );
      }

      const result = await withTenantTransaction(
        context.enterpriseId!,
        async (transaction) => {
          const repository = new AdminUserRepository(transaction);
          const staff = await repository.findById(staffId);
          if (!staff) return { kind: 'not_found' as const };
          if (!RESETTABLE_ROLES.has(staff.role)) {
            return { kind: 'unsupported_role' as const };
          }
          if (
            context.role === 'enterprise_admin' &&
            staff.role === 'enterprise_admin'
          ) {
            return { kind: 'forbidden' as const };
          }
          const updated = await repository.update(staffId, {
            passwordHash: await hashStaffInitialPassword(),
            mustChangePassword: true,
          });
          return { kind: 'ok' as const, updated };
        }
      );

      if (result.kind === 'not_found') {
        return NextResponse.json(
          { success: false, error: '员工账号不存在' },
          { status: 404 }
        );
      }
      if (result.kind === 'forbidden') {
        return NextResponse.json(
          { success: false, error: '企业负责人不能重置其他负责人账号' },
          { status: 403 }
        );
      }
      if (result.kind === 'unsupported_role') {
        return NextResponse.json(
          { success: false, error: '该账号类型不支持员工密码重置' },
          { status: 400 }
        );
      }
      return NextResponse.json({
        success: true,
        data: { mustChangePassword: true },
      });
    }
  );
}
