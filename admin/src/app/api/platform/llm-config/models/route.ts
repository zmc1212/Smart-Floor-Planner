import { NextResponse } from 'next/server';
import { listPlatformLlmModels } from '@/lib/platform-llm-config';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const body = await request.json() as Record<string, unknown>;
      return NextResponse.json({ success: true, data: await listPlatformLlmModels(body) });
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '拉取模型目录失败' },
      { status: 502 }
    );
  }
}
