import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { AiCreationModelProfile } from '@/models/AiCreationModelProfile';
import { AiCreationTask } from '@/models/AiCreationTask';
import { MediaAsset } from '@/models/MediaAsset';
import { reconcileCreationTasks, serializeCreationTask } from '@/lib/ai/creation-service';

export async function GET(request: Request) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { requireEnterprise: true }, async () => {
      const url = new URL(request.url);
      const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
      const limit = Math.min(30, Math.max(1, Number(url.searchParams.get('limit')) || 12));
      const query = url.searchParams.get('q')?.trim();
      const filter: Record<string, unknown> = { deletedAt: { $exists: false } };
      if (query) filter.$or = [
        { title: { $regex: query, $options: 'i' } },
        { prompt: { $regex: query, $options: 'i' } },
      ];
      const [tasks, total] = await Promise.all([
        AiCreationTask.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit),
        AiCreationTask.countDocuments(filter),
      ]);
      await reconcileCreationTasks(tasks);
      return NextResponse.json({
        success: true,
        data: await Promise.all(tasks.map(serializeCreationTask)),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    });
  } catch (error) {
    console.error('[AI Creation Tasks GET]', error);
    return NextResponse.json({ success: false, error: '加载创作历史失败' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { requireEnterprise: true }, async (context) => {
      const body = await request.json() as {
        title?: string;
        prompt?: string;
        referenceAssetIds?: string[];
        modelProfileId?: string;
      };
      const prompt = String(body.prompt || '').trim();
      const title = String(body.title || prompt.slice(0, 30) || '未命名创作').trim();
      if (!prompt) return NextResponse.json({ success: false, error: '请输入提示词' }, { status: 400 });
      if (!body.modelProfileId) return NextResponse.json({ success: false, error: '请选择模型' }, { status: 400 });
      const profile = await AiCreationModelProfile.findOne({
        _id: body.modelProfileId,
        sourceType: 'grs_catalog',
        enabled: true,
      });
      if (!profile) return NextResponse.json({ success: false, error: '所选模型不可用' }, { status: 400 });
      const referenceAssetIds = [...new Set((body.referenceAssetIds || []).map(String))];
      const assetCount = referenceAssetIds.length
        ? await MediaAsset.countDocuments({
            _id: { $in: referenceAssetIds },
            enterpriseId: context.enterpriseId,
            deletedAt: { $exists: false },
          })
        : 0;
      if (assetCount !== referenceAssetIds.length) {
        return NextResponse.json({ success: false, error: '参考图不存在或无权访问' }, { status: 400 });
      }
      const task = await AiCreationTask.create({
        enterpriseId: String(context.enterpriseId),
        operatorId: context.userId,
        title,
        prompt,
        referenceAssetIds,
        modelProfileId: profile._id,
        status: 'active',
      });
      return NextResponse.json({ success: true, data: await serializeCreationTask(task) });
    });
  } catch (error) {
    console.error('[AI Creation Tasks POST]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '创建任务失败' },
      { status: 400 }
    );
  }
}
