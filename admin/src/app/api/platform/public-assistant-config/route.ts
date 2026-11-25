import { NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import {
  getPublicAssistantConfig,
  publicAssistantConfigDto,
  savePublicAssistantConfig,
  type PublicAssistantConfigInput,
} from '@/lib/assistant/public-config';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () =>
      NextResponse.json({ success: true, data: publicAssistantConfigDto(await getPublicAssistantConfig()) })
    );
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '读取通用小K配置失败' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const body = await request.json() as PublicAssistantConfigInput;
      const data = await savePublicAssistantConfig(body);
      return NextResponse.json({ success: true, data: publicAssistantConfigDto(data) });
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '保存通用小K配置失败' },
      { status: typeof (error as { status?: unknown })?.status === 'number' ? Number((error as { status: number }).status) : 400 },
    );
  }
}
