import { NextResponse } from 'next/server';
import {
  getPlatformAiPromptConfig,
  platformAiPromptConfigDto,
  savePlatformAiPromptConfig,
} from '@/lib/ai/platform-ai-prompt-config';
import { withTenantRoute } from '@/lib/tenant-route';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin'] },
      async () => NextResponse.json({
        success: true,
        data: platformAiPromptConfigDto(await getPlatformAiPromptConfig()),
      })
    );
  } catch (error: unknown) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '读取 AI 内置提示词失败',
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    return await withTenantRoute(
      request,
      { roles: ['super_admin', 'admin'] },
      async () => {
        const body = (await request.json()) as {
          floorPlanConstraintPrompt?: unknown;
        };
        const config = await savePlatformAiPromptConfig(
          body.floorPlanConstraintPrompt
        );
        return NextResponse.json({
          success: true,
          data: platformAiPromptConfigDto(config),
        });
      }
    );
  } catch (error: unknown) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '保存 AI 内置提示词失败',
      },
      { status: 400 }
    );
  }
}
