import { NextResponse } from 'next/server';
import {
  getPlatformLlmConfig,
  savePlatformLlmConfig,
  type PlatformLlmConfigInput,
} from '@/lib/platform-llm-config';
import { parsePostgresId } from '@/db/postgres-dto';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
    return NextResponse.json({ success: true, data: await getPlatformLlmConfig() });
  });
}

export async function PATCH(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async (context) => {
      const body = await request.json() as PlatformLlmConfigInput;
      const data = await savePlatformLlmConfig(
        body,
        parsePostgresId(context.userId, 'userId')
      );
      return NextResponse.json({ success: true, data });
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '保存 LLM 大模型配置失败' },
      { status: 400 }
    );
  }
}
