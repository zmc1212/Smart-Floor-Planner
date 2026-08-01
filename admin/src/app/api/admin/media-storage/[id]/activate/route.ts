import { NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import {
  activateMediaStorageProvider,
  findMediaStorageConfigById,
  safeMediaStorageError,
} from '@/lib/media-storage/config-service';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async (context) => {
      const { id } = await params;
      let providerKey = 'local';
      if (id !== 'local') {
        const config = await findMediaStorageConfigById(id);
        if (!config) {
          return NextResponse.json({ success: false, error: '媒体存储配置不存在' }, { status: 404 });
        }
        providerKey = config.key;
      }
      const activeProviderKey = await activateMediaStorageProvider(providerKey, context.userId);
      return NextResponse.json({ success: true, data: { activeProviderKey } });
    });
  } catch (error) {
    const message = safeMediaStorageError(error);
    console.error('[Media Storage Activate]', message);
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
