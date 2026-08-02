import { NextResponse } from 'next/server';
import { AiProviderConfigRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { ensureGrsImageModelCatalog, serializeCatalogProfile } from '@/lib/ai/image-model-catalog';
import { listGrsImageModelIds } from '@/lib/ai/grs-image-models';
import { AiCreationModelProfile } from '@/models/AiCreationModelProfile';

export async function GET(request: Request) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      await ensureGrsImageModelCatalog();
      const profiles = await AiCreationModelProfile.find({ sourceType: 'grs_catalog' })
        .sort({ isDefault: -1, weight: -1, name: 1 });
      const providers = await withPlatformTransaction((transaction) =>
        new AiProviderConfigRepository(transaction).listEnabled({
          adapterType: 'grs',
        })
      );
      const knownModels = new Set(listGrsImageModelIds());
      const unknownModels = [...new Set(
        providers.flatMap((provider) => {
          const state = provider.operationalState ?? {};
          return Array.isArray(state.discoveredModels)
            ? state.discoveredModels.filter(
                (model): model is string => typeof model === 'string'
              )
            : [];
        })
      )]
        .filter((model) => !knownModels.has(model))
        .sort()
        .map((model) => ({
          id: `discovered:${model}`,
          key: `discovered-${model}`,
          name: model,
          description: '供应商同步发现，当前目录没有参数能力定义',
          sourceType: 'discovered_unknown',
          adapterType: 'grs',
          remoteModel: model,
          family: 'unknown',
          catalogVersion: '',
          supportsReferenceImages: false,
          maxReferenceImages: 0,
          aspectRatios: [],
          resolutionTiers: [],
          supportsCustomSize: false,
          defaultAspectRatio: '',
          defaultResolutionTier: '',
          enabled: false,
          isDefault: false,
          weight: 0,
          executable: false,
        }));
      return NextResponse.json({
        success: true,
        data: [...profiles.map(serializeCatalogProfile), ...unknownModels],
      });
    });
  } catch (error) {
    console.error('[AI Image Models GET]', error);
    return NextResponse.json({ success: false, error: '读取生图模型目录失败' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      await ensureGrsImageModelCatalog();
      const body = await request.json() as {
        items?: Array<{ id: string; enabled: boolean; isDefault: boolean; maxReferenceImages: number }>;
      };
      if (!Array.isArray(body.items) || !body.items.length) {
        return NextResponse.json({ success: false, error: '缺少模型配置' }, { status: 400 });
      }
      const defaults = body.items.filter((item) => item.isDefault);
      if (defaults.length !== 1 || !defaults[0].enabled) {
        return NextResponse.json({ success: false, error: '必须指定一个已启用的默认模型' }, { status: 400 });
      }
      const ids = body.items.map((item) => item.id);
      const count = await AiCreationModelProfile.countDocuments({
        _id: { $in: ids },
        sourceType: 'grs_catalog',
      });
      if (count !== ids.length) {
        return NextResponse.json({ success: false, error: '模型配置包含无效项目' }, { status: 400 });
      }
      const normalizedItems = body.items.map((item) => {
        const maxReferenceImages = Math.trunc(Number(item.maxReferenceImages));
        if (maxReferenceImages < 0 || maxReferenceImages > 10) {
          throw new Error('参考图上限必须在 0-10 之间');
        }
        return { ...item, maxReferenceImages };
      });
      await AiCreationModelProfile.updateMany({ sourceType: 'grs_catalog' }, { $set: { isDefault: false } });
      await Promise.all(normalizedItems.map((item) => {
        return AiCreationModelProfile.updateOne(
          { _id: item.id, sourceType: 'grs_catalog' },
          { $set: {
            enabled: Boolean(item.enabled),
            isDefault: Boolean(item.isDefault),
            maxReferenceImages: item.maxReferenceImages,
            supportsReferenceImages: item.maxReferenceImages > 0,
          } }
        );
      }));
      const profiles = await AiCreationModelProfile.find({ sourceType: 'grs_catalog' })
        .sort({ isDefault: -1, weight: -1, name: 1 });
      return NextResponse.json({ success: true, data: profiles.map(serializeCatalogProfile) });
    });
  } catch (error) {
    console.error('[AI Image Models PATCH]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '保存生图模型配置失败' },
      { status: 400 }
    );
  }
}
