import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import {
  archiveMediaStorageConfig,
  safeMediaStorageError,
  serializeMediaStorageConfig,
  updateMediaStorageConfig,
} from '@/lib/media-storage/config-service';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async (context) => {
      const { id } = await params;
      const config = await updateMediaStorageConfig(id, await request.json(), context.userId);
      return NextResponse.json({ success: true, data: serializeMediaStorageConfig(config) });
    });
  } catch (error) {
    console.error('[Media Storage PATCH]', safeMediaStorageError(error));
    return NextResponse.json(
      { success: false, error: safeMediaStorageError(error) },
      { status: safeMediaStorageError(error).includes('不存在') ? 404 : 400 }
    );
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    await dbConnect();
    return await withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async (context) => {
      const { id } = await params;
      const config = await archiveMediaStorageConfig(id, context.userId);
      return NextResponse.json({ success: true, data: serializeMediaStorageConfig(config) });
    });
  } catch (error) {
    console.error('[Media Storage DELETE]', safeMediaStorageError(error));
    return NextResponse.json(
      { success: false, error: safeMediaStorageError(error) },
      { status: safeMediaStorageError(error).includes('不存在') ? 404 : 400 }
    );
  }
}
