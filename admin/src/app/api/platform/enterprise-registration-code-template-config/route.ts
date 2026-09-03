import { NextResponse } from 'next/server';
import {
  ENTERPRISE_REGISTRATION_TEMPLATE_LABELS,
  getPlatformEnterpriseRegistrationCodeTemplateConfig,
  savePlatformEnterpriseRegistrationCodeTemplateConfig,
  type EnterpriseRegistrationQrPlacement,
} from '@/lib/platform-enterprise-registration-code-template-config';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

function serializeConfig(
  config: Awaited<ReturnType<typeof getPlatformEnterpriseRegistrationCodeTemplateConfig>>
) {
  return {
    ...config,
    templateLabel: ENTERPRISE_REGISTRATION_TEMPLATE_LABELS[config.templateId],
  };
}

export async function GET(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () =>
      NextResponse.json({
        success: true,
        data: serializeConfig(await getPlatformEnterpriseRegistrationCodeTemplateConfig()),
      })
    );
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const body = (await request.json()) as {
        templateId?: unknown;
        qrPlacement?: Partial<EnterpriseRegistrationQrPlacement>;
      };
      const data = await savePlatformEnterpriseRegistrationCodeTemplateConfig({
        templateId: body.templateId as never,
        qrPlacement: body.qrPlacement,
      });
      return NextResponse.json({ success: true, data: serializeConfig(data) });
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    );
  }
}
