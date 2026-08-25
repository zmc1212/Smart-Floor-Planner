import { NextResponse } from 'next/server';
import { parsePostgresId } from '@/db/postgres-dto';
import { EnterpriseRepository } from '@/db/repositories';
import { withAdminPostgresTransaction } from '@/lib/postgres-request-scope';
import {
  normalizeProfessionalTitle,
  validateProfessionalTitleVisibilityPolicy,
} from '@/lib/professional-profile';
import { withTenantRoute } from '@/lib/tenant-route';

function integer(value: unknown, min: number, max: number, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw Object.assign(new Error(`${label}范围应为 ${min}–${max}`), { status: 400 });
  }
  return parsed;
}

function serialize(enterprise: NonNullable<Awaited<ReturnType<EnterpriseRepository['findById']>>>) {
  return {
    designerTitle: enterprise.professionalDesignerTitle,
    measurerTitle: enterprise.professionalMeasurerTitle,
    defaultExperienceYears: enterprise.professionalDefaultExperienceYears,
    serviceThreshold: enterprise.professionalServiceThreshold,
    forceEnterpriseProfile: enterprise.professionalForceEnterpriseProfile,
    titleVisibilityPolicy: enterprise.professionalTitleVisibilityPolicy,
  };
}

export async function GET(request: Request) {
  return withTenantRoute(
    request,
    {
      roles: ['enterprise_admin', 'admin', 'super_admin'],
      requireEnterprise: true,
    },
    async (context) => {
      const enterprise = await withAdminPostgresTransaction(context, (transaction) =>
        new EnterpriseRepository(transaction).findById(
          parsePostgresId(context.enterpriseId!, 'enterprise id')
        )
      );
      if (!enterprise) {
        return NextResponse.json({ success: false, error: '企业不存在' }, { status: 404 });
      }
      return NextResponse.json({ success: true, data: serialize(enterprise) });
    }
  );
}

export async function PUT(request: Request) {
  try {
    return await withTenantRoute(
      request,
      {
        roles: ['enterprise_admin', 'admin', 'super_admin'],
        requireEnterprise: true,
      },
      async (context) => {
        const body = await request.json();
        const designerTitle = normalizeProfessionalTitle(body.designerTitle, '设计师默认头衔');
        const measurerTitle = normalizeProfessionalTitle(body.measurerTitle, '测量员默认头衔');
        if (!designerTitle || !measurerTitle) {
          throw Object.assign(new Error('设计师和测量员默认头衔不能为空'), { status: 400 });
        }
        const updated = await withAdminPostgresTransaction(context, (transaction) =>
          new EnterpriseRepository(transaction).update(
            parsePostgresId(context.enterpriseId!, 'enterprise id'),
            {
              professionalDesignerTitle: designerTitle,
              professionalMeasurerTitle: measurerTitle,
              professionalDefaultExperienceYears: integer(
                body.defaultExperienceYears,
                1,
                100,
                '默认经验年限'
              ),
              professionalServiceThreshold: integer(
                body.serviceThreshold,
                100,
                1000000,
                '客户背书门槛'
              ),
              professionalForceEnterpriseProfile: Boolean(body.forceEnterpriseProfile),
              professionalTitleVisibilityPolicy:
                validateProfessionalTitleVisibilityPolicy(body.titleVisibilityPolicy),
            }
          )
        );
        if (!updated) {
          return NextResponse.json({ success: false, error: '企业不存在' }, { status: 404 });
        }
        return NextResponse.json({ success: true, data: serialize(updated) });
      }
    );
  } catch (error) {
    const status = (error as { status?: number }).status || 400;
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '保存专业背书设置失败',
    }, { status });
  }
}
