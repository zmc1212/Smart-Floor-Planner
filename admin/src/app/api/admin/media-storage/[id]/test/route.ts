import { NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import {
  safeMediaStorageError,
  testAndRecordMediaStorageConfig,
  testMediaStorageProvider,
} from '@/lib/media-storage/config-service';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async () => {
      const { id } = await params;
      const result = id === 'local'
        ? await testMediaStorageProvider('local')
        : await testAndRecordMediaStorageConfig(id);
      return NextResponse.json({ success: true, data: result });
    });
  } catch (error) {
    const message = safeMediaStorageError(error);
    console.error('[Media Storage Test]', message);
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
