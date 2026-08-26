import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { AdminUserRepository, ProfessionalProfileRepository } from '@/db/repositories';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { withMiniProgramPostgresTransaction } from '@/lib/postgres-request-scope';
import {
  isProfessionalProfileRole,
  normalizeProfessionalTitle,
  validateCareerStartYear,
} from '@/lib/professional-profile';

export const dynamic = 'force-dynamic';

async function professionalStaffContext(request: Request) {
  const context = await resolveMiniProgramContext(request);
  if (!context) return { error: NextResponse.json({ success: false, error: '需要有效登录身份' }, { status: 401 }) };
  if (!context.enterpriseId || context.mode !== 'staff' || !context.staff || !isProfessionalProfileRole(context.staff.role)) {
    return { error: NextResponse.json({ success: false, error: '仅家装设计顾问和家装现场顾问可维护职业资料' }, { status: 403 }) };
  }
  return { context, staffId: parsePostgresId(context.staff._id, 'staff id') };
}

export async function GET(request: Request) {
  const resolved = await professionalStaffContext(request);
  if ('error' in resolved) return resolved.error;
  const profile = await withMiniProgramPostgresTransaction(resolved.context, (transaction) =>
    new ProfessionalProfileRepository(transaction).findForStaff(resolved.staffId)
  );
  if (!profile) return NextResponse.json({ success: false, error: '职业资料不存在' }, { status: 404 });
  return NextResponse.json({ success: true, data: profile });
}

export async function PATCH(request: Request) {
  try {
    const resolved = await professionalStaffContext(request);
    if ('error' in resolved) return resolved.error;
    const body = await request.json();
    const profile = await withMiniProgramPostgresTransaction(resolved.context, async (transaction) => {
      const repository = new AdminUserRepository(transaction);
      const current = await repository.findById(resolved.staffId);
      if (!current || !isProfessionalProfileRole(current.role)) return null;
      if (current.professionalProfileLocked) {
        throw Object.assign(new Error('职业资料已由企业管理员锁定，请联系管理员修改'), { status: 409 });
      }
      const currentProfile = await new ProfessionalProfileRepository(transaction).findForStaff(resolved.staffId);
      if (!currentProfile) return null;
      const showActualServiceCount = Boolean(body.showActualServiceCount);
      if (showActualServiceCount && !currentProfile.canShowActualServiceCount) {
        throw Object.assign(new Error('真实服务客户数超过企业门槛后才能对外展示'), { status: 409 });
      }
      await repository.update(resolved.staffId, {
        professionalTitle: normalizeProfessionalTitle(body.title) || null,
        professionalCareerStartYear: validateCareerStartYear(body.careerStartYear),
        professionalTitleVisible: body.titleVisible !== false,
        professionalShowActualServiceCount: showActualServiceCount,
      });
      return new ProfessionalProfileRepository(transaction).findForStaff(resolved.staffId);
    });
    if (!profile) return NextResponse.json({ success: false, error: '职业资料不存在' }, { status: 404 });
    return NextResponse.json({ success: true, data: profile });
  } catch (error) {
    const status = (error as { status?: number }).status || 400;
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '保存职业资料失败',
    }, { status });
  }
}
