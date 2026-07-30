import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { withTenantRoute } from '@/lib/tenant-route';
import { getActivePromptTemplateAsset } from '@/lib/ai/prompt-library-query';
import { resolveMediaObjectDelivery } from '@/lib/media-storage/operations';
import { getMediaStorageProvider } from '@/lib/media-storage/registry';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    return await withTenantRoute(req, {}, async () => {
      const { id } = await params;
      const asset = await getActivePromptTemplateAsset(id);
      if (!asset) return NextResponse.json({ success: false, error: 'Prompt preview not found' }, { status: 404 });
      const provider = await getMediaStorageProvider(asset.storageProvider);
      const delivery = await resolveMediaObjectDelivery({
        provider,
        location: { objectKey: asset.storageKey, bucket: asset.storageBucket },
        expiresInSeconds: 3600,
      });
      if (delivery.kind === 'redirect') {
        return NextResponse.redirect(delivery.url, { status: 302, headers: { 'Cache-Control': 'private, no-store' } });
      }
      return new NextResponse(new Uint8Array(delivery.buffer), {
        headers: {
          'Content-Type': asset.mimeType,
          'Content-Length': String(delivery.buffer.length),
          'ETag': `\"${asset.checksumSha256}\"`,
          'Cache-Control': 'private, max-age=86400',
        },
      });
    });
  } catch (error) {
    console.error('[AI Prompt Preview GET]', error);
    return NextResponse.json({ success: false, error: 'Failed to load prompt preview' }, { status: 500 });
  }
}
