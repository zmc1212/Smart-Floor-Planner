import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AdminUserRepository, ProfessionalProfileRepository } from '@/db/repositories';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';
import {
  isProfessionalProfileRole,
  normalizeProfessionalTitle,
  validateCareerStartYear,
} from '@/lib/professional-profile';
import { withTenantRoute } from '@/lib/tenant-route';

async function resolveProfile(
  context: Parameters<Parameters<typeof withTenantRoute>[2]>[0],
  staffId: bigint
) {
  return withAdminPostgresTransaction(context, async (transaction) => {
    const staff = await new AdminUserRepository(transaction).findById(staffId);
    if (!staff || !isProfessionalProfileRole(staff.role)) return null;
    return new ProfessionalProfileRepository(transaction).findForStaff(staffId);
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withTenantRoute(
    request,
    {
      roles: ['enterprise_admin', 'admin', 'super_admin'],
      requireEnterprise: true,
    },
    async (context) => {
      const { id } = await params;
      const profile = await resolveProfile(context, parsePostgresId(id, 'staff id'));
      if (!profile) {
        return NextResponse.json({ success: false, error: '专业员工不存在' }, { status: 404 });
      }
      return NextResponse.json({ success: true, data: profile });
    }
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    return await withTenantRoute(
      request,
      {
        roles: ['enterprise_admin', 'admin', 'super_admin'],
        requireEnterprise: true,
      },
      async (context) => {
        const { id } = await params;
        const staffId = parsePostgresId(id, 'staff id');
        const body = await request.json();
        const profile = await withAdminPostgresTransaction(context, async (transaction) => {
          const repository = new AdminUserRepository(transaction);
          const current = await repository.findById(staffId);
          if (!current || !isProfessionalProfileRole(current.role)) return null;
          const currentProfile = await new ProfessionalProfileRepository(transaction).findForStaff(staffId);
          if (!currentProfile) return null;
          const showActualServiceCount = Boolean(body.showActualServiceCount);
          if (showActualServiceCount && !currentProfile.canShowActualServiceCount) {
            throw Object.assign(new Error('真实服务客户数超过企业门槛后才能对外展示'), { status: 409 });
          }
          await repository.update(staffId, {
            professionalTitleAdminOverride: normalizeProfessionalTitle(
              body.adminTitleOverride,
              '单员工专属头衔'
            ) || null,
            professionalCareerStartYear: validateCareerStartYear(body.careerStartYear),
            professionalTitleVisible: body.titleVisible !== false,
            professionalProfileLocked: Boolean(body.profileLocked),
            professionalShowActualServiceCount: showActualServiceCount,
          });
          return new ProfessionalProfileRepository(transaction).findForStaff(staffId);
        });
        if (!profile) {
          return NextResponse.json({ success: false, error: '专业员工不存在' }, { status: 404 });
        }
        return NextResponse.json({ success: true, data: profile });
      }
    );
  } catch (error) {
    const status = (error as { status?: number }).status || 400;
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '保存员工专业背书失败',
    }, { status });
  }
}
