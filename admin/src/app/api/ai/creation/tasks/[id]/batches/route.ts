import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { createCreationBatch, serializeCreationTask } from '@/lib/ai/creation-service';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { requireEnterprise: true }, async (context) => {
      const { id } = await params;
      const body = await request.json() as {
        prompt?: string;
        negativePrompt?: string;
        referenceAssetIds?: string[];
        modelProfileId?: string;
        aspectRatio?: string;
        resolutionTier?: '1K' | '2K' | '4K' | 'CUSTOM';
        width?: number;
        height?: number;
        size?: string;
        quality?: string;
        templateId?: string;
        count?: number;
      };
      if (!body.modelProfileId) {
        return NextResponse.json({ success: false, error: '请选择模型' }, { status: 400 });
      }
      const result = await createCreationBatch({
        enterpriseId: String(context.enterpriseId),
        operatorId: context.userId,
        taskId: id,
        prompt: String(body.prompt || ''),
        negativePrompt: body.negativePrompt,
        referenceAssetIds: body.referenceAssetIds,
        modelProfileId: body.modelProfileId,
        parameters: {
          aspectRatio: body.aspectRatio,
          resolutionTier: body.resolutionTier,
          width: body.width,
          height: body.height,
          size: body.size,
          quality: body.quality,
        },
        templateId: body.templateId,
        count: body.count,
      });
      return NextResponse.json({
        success: true,
        data: {
          task: await serializeCreationTask(result.task),
          account: result.account,
        },
      });
    });
  } catch (error) {
    console.error('[AI Creation Batch POST]', error);
    const status = (error as { status?: number })?.status || 400;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '生成任务提交失败' },
      { status }
    );
  }
}
