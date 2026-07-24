import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { AiGeneration } from '@/models/AiGeneration';
import { MediaAsset } from '@/models/MediaAsset';
import { getAssetIdFromImageUrl } from '@/lib/ai/media-assets';
import { resolveMiniAiContext } from '@/lib/ai/mini-ai-auth';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const context = await resolveMiniAiContext(request);
    if (!context) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const generation = await AiGeneration.findOne({
      _id: id,
      enterpriseId: context.enterpriseId,
      operatorId: context.operatorId,
      channel: 'miniprogram',
      deletedAt: { $exists: false },
    });
    if (!generation) return NextResponse.json({ success: false, error: '记录不存在' }, { status: 404 });
    if (generation.status === 'processing' || generation.billing?.status === 'held') {
      return NextResponse.json({ success: false, error: '生成中的任务不能删除' }, { status: 409 });
    }

    const assetIds = [
      getAssetIdFromImageUrl(generation.input.spaceImage),
      getAssetIdFromImageUrl(generation.input.referenceImage),
      getAssetIdFromImageUrl(generation.input.controlImage),
      getAssetIdFromImageUrl(generation.output.imageUrl),
    ].filter((assetId): assetId is string => Boolean(assetId));
    const deletedAt = new Date();
    generation.deletedAt = deletedAt;
    await generation.save();
    if (assetIds.length > 0) {
      await MediaAsset.updateMany(
        { _id: { $in: assetIds }, enterpriseId: context.enterpriseId, ownerId: generation._id },
        { $set: { deletedAt } }
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Mini AI History Delete]', error);
    return NextResponse.json({ success: false, error: '删除历史失败' }, { status: 500 });
  }
}
