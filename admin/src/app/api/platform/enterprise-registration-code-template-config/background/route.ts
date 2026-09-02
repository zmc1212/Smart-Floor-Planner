import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import {
  ENTERPRISE_REGISTRATION_TEMPLATE_IDS,
  getEnterpriseRegistrationTemplateBackgroundPath,
  type EnterpriseRegistrationTemplateId,
} from '@/lib/platform-enterprise-registration-code-template-config';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

function parseTemplateId(request: Request): EnterpriseRegistrationTemplateId {
  const value = new URL(request.url).searchParams.get('templateId');
  if (
    ENTERPRISE_REGISTRATION_TEMPLATE_IDS.includes(value as EnterpriseRegistrationTemplateId)
  ) {
    return value as EnterpriseRegistrationTemplateId;
  }
  return 'merchant-onboarding-v1';
}

export async function GET(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const templateId = parseTemplateId(request);
      const background = await readFile(getEnterpriseRegistrationTemplateBackgroundPath(templateId));
      return new NextResponse(background, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'private, max-age=3600',
        },
      });
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
