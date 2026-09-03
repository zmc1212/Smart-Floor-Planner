import { NextResponse } from 'next/server';
import { testPlatformLlmConnection } from '@/lib/platform-llm-config';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';
export const maxDuration = 100;

export async function POST(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const body = await request.json() as Record<string, unknown>;
      return NextResponse.json({ success: true, data: await testPlatformLlmConnection(body) });
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'LLM 大模型连接测试失败' },
      { status: 502 }
    );
  }
}
