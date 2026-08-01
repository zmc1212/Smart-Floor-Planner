import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import {
  createMediaStorageConfig,
  getMediaStorageAssetStats,
  getPlatformMediaStorageState,
  listMediaStorageConfigs,
  mediaStorageEncryptionState,
  safeMediaStorageError,
  serializeMediaStorageConfig,
  updateGrsAiOutputPersistence,
} from '@/lib/media-storage/config-service';
import { normalizeMediaStorageProviderKey } from '@/lib/media-storage/registry';

export async function GET(request: Request) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const [configs, platformConfig, stats] = await Promise.all([
        listMediaStorageConfigs(),
        getPlatformMediaStorageState(),
        getMediaStorageAssetStats(),
      ]);
      const activeProviderKey = normalizeMediaStorageProviderKey(
        platformConfig.activeProviderKey ||
          process.env.MEDIA_STORAGE_PROVIDER ||
          'local'
      );
      return NextResponse.json({
        success: true,
        data: {
          activeProviderKey,
          activatedAt: platformConfig.activatedAt || null,
          grsOutputPersistence: {
            enabled: platformConfig.persistGrsAiOutputs === true,
          },
          encryption: mediaStorageEncryptionState(),
          local: {
            id: 'local',
            key: 'local',
            name: '服务器本地存储',
            driver: 'local',
            status: 'active',
            persistent: Boolean(process.env.AI_ASSET_STORAGE_DIR),
            storageDirectoryConfigured: Boolean(process.env.AI_ASSET_STORAGE_DIR),
            stats: stats.local || null,
          },
          configs: configs.map((config) => ({
            ...serializeMediaStorageConfig(config),
            stats: stats[config.key] || null,
          })),
        },
      });
    });
  } catch (error) {
    console.error('[Media Storage GET]', safeMediaStorageError(error));
    return NextResponse.json({ success: false, error: '读取媒体存储配置失败' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async (context) => {
      const body = await request.json();
      if (typeof body.persistGrsAiOutputs !== 'boolean') {
        return NextResponse.json(
          { success: false, error: 'persistGrsAiOutputs 必须是布尔值' },
          { status: 400 }
        );
      }
      const result = await updateGrsAiOutputPersistence(body.persistGrsAiOutputs, context.userId);
      return NextResponse.json({ success: true, data: result });
    });
  } catch (error) {
    const message = safeMediaStorageError(error);
    console.error('[Media Storage PATCH]', message);
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async (context) => {
      const config = await createMediaStorageConfig(await request.json(), context.userId);
      return NextResponse.json(
        { success: true, data: serializeMediaStorageConfig(config) },
        { status: 201 }
      );
    });
  } catch (error) {
    const code = (error as { code?: number | string })?.code;
    const duplicate = code === 11000 || code === '23505';
    console.error('[Media Storage POST]', safeMediaStorageError(error));
    return NextResponse.json(
      {
        success: false,
        error: duplicate ? '媒体存储配置标识已存在' : safeMediaStorageError(error),
      },
      { status: duplicate ? 409 : 400 }
    );
  }
}
